import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { open, lstat, mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { renderMemory, type LongEntry } from './format.ts';
import { atomicWrite, writeJournal, type WriteJournal } from './journal.ts';
import { storeLock, storeState } from './lock.ts';
export { renderMemory, parseMemory, type LongEntry } from './format.ts';

export const TEMP_MAX_BYTES = 2 * 1024 * 1024;

export type MemoryScope = 'general' | 'approvals' | string;
export interface TempInput { at: number; type: string; [key: string]: unknown }
export interface TempRecord extends TempInput { session: string }
export interface MemoryStoreOptions {
  rootDir?: string;
  lockFile?: string;
  approvalsDir?: string;
  now?: () => number;
  onError?: (error: unknown) => void;
}

/** Safe single path component; the suffix preserves identity when replacement is lossy. */
export function safeSegment(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Error('Memory path component must not be blank');
  const replaced = value.replace(/[^A-Za-z0-9._-]/g, '_');
  const safe = replaced === '.' || replaced === '..' ? `_${replaced}` : replaced;
  // Reserve '--' for derived names; hash uppercase too for case-insensitive volumes.
  return safe === value && safe.length <= 160 && !safe.includes('--') && !/[A-Z]/.test(safe) ? safe
    : `${safe.slice(0, 160)}--${createHash('sha256').update(value).digest('hex')}`;
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
/** Resolve trusted configuration aliases even before the leaf directory exists. */
function canonicalPath(path: string): string {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try { return join(realpathSync.native(ancestor), ...suffix); }
    catch (error) {
      if (!missing(error) || dirname(ancestor) === ancestor) return resolve(path);
      suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor);
    }
  }
}
function sessionSegment(session: string): string {
  if (session === 'general' || session === 'approvals') throw Error('Reserved memory scope cannot be a session id');
  return safeSegment(session);
}
function longFile(file: string): string {
  if (typeof file !== 'string' || !/^[A-Za-z0-9._-][A-Za-z0-9:._-]*\.html$/.test(file)) throw Error('Invalid memory file basename');
  return file;
}
function tempRecord(value: unknown, session: string): value is TempRecord {
  const v = value as TempRecord | null;
  return !!v && !Array.isArray(v) && typeof v === 'object' && v.session === session &&
    typeof v.type === 'string' && !!v.type.trim() && Number.isFinite(v.at) && v.at >= 0 &&
    v.at <= Date.UTC(9999, 11, 31, 23, 59, 59, 999);
}

/** UTF-8 storage shared by memory tools and approval recording.
 * Scope names general/approvals are reserved; other scopes are session ids.
 * with*Lock callbacks are non-reentrant: do not call store methods within them.
 * lock.json is diagnostic only; operation I/O errors reject, diagnostic errors do not.
 */
export class MemoryStore {
  readonly rootDir: string;
  private approvalsDir: string;
  private now: () => number;
  private journal: WriteJournal;

  constructor(options: MemoryStoreOptions = {}) {
    this.rootDir = canonicalPath(options.rootDir ?? join(homedir(), '.dsh', 'jarvis'));
    this.approvalsDir = canonicalPath(options.approvalsDir ?? join(this.rootDir, 'memory', 'approvals'));
    this.now = options.now ?? Date.now;
    this.journal = writeJournal(canonicalPath(options.lockFile ?? join(this.rootDir, 'lock.json')),
      this.now(), options.onError ?? (() => {}));
  }

  ready(): Promise<void> { return this.journal.ready; }

  /** Process-local revision for successful long-entry writes/removals, shared across instances. */
  version(scope: MemoryScope = 'general'): number { return storeState(this.directory(scope)).longVersion; }

  private directory(scope: MemoryScope): string {
    if (scope === 'approvals') return this.approvalsDir;
    return join(this.rootDir, 'memory', scope === 'general' ? scope : sessionSegment(scope));
  }

  /** Callback receives the long-store directory; it owns any raw I/O within this lock. */
  async withReadLock<T>(scope: MemoryScope, fn: (directory: string) => T | Promise<T>): Promise<T> {
    const directory = this.directory(scope);
    await this.ready();
    return storeLock(directory).run(false, () => fn(directory));
  }

  /** Same-scope writes exclude reads, including across MemoryStore instances. */
  async withWriteLock<T>(scope: MemoryScope, fn: (directory: string) => T | Promise<T>): Promise<T> {
    const directory = this.directory(scope);
    await this.ready();
    return storeLock(directory).run(true, async () => {
      const marker = await this.journal.begin(scope, this.now());
      try { return await fn(directory); }
      finally { await this.journal.end(marker); }
    });
  }

  // Roots are trusted configuration; descendants must not redirect via symlinks.
  private async directoryExists(directory: string, create = false): Promise<boolean> {
    const rel = relative(this.rootDir, directory);
    const external = rel === '..' || rel.startsWith(`..${sep}`);
    const base = external ? dirname(directory) : this.rootDir;
    if (create) await mkdir(base, { recursive: true, mode: 0o700 });
    const parts = external ? [directory] : rel.split(sep).filter(Boolean).map((_, i, all) => join(base, ...all.slice(0, i + 1)));
    for (const path of parts) {
      if (create) {
        try { await mkdir(path, { mode: 0o700 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      let stat;
      try { stat = await lstat(path); }
      catch (error) { if (!create && missing(error)) return false; throw error; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Memory directory is not a regular directory');
    }
    return true;
  }

  private async regularFile(file: string): Promise<boolean> {
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Memory file is not a regular file');
      return true;
    } catch (error) { if (missing(error)) return false; throw error; }
  }

  /** at/since are epoch milliseconds; files use the record's UTC calendar date. */
  async appendTemp(session: string, record: TempInput): Promise<void> {
    const name = sessionSegment(session);
    const value = { ...record, session };
    if (!tempRecord(value, session)) throw Error('Invalid temporary memory record');
    const line = JSON.stringify(value) + '\n';
    const date = new Date(value.at).toISOString().slice(0, 10);
    await this.withWriteLock(session, async () => {
      const directory = join(this.rootDir, 'temp', name);
      await this.directoryExists(directory, true);
      const path = join(directory, `${date}.jsonl`);
      await this.regularFile(path);
      const handle = await open(path, 'a+', 0o600);
      try {
        const { size } = await handle.stat();
        const marker = JSON.stringify({ session, at: value.at, type: 'truncated' }) + '\n';
        // The last marker survives restart; inspect enough tail bytes even for long raw session ids.
        const tail = Buffer.alloc(Math.min(size, Math.max(4096, Buffer.byteLength(marker) + 64)));
        if (size) await handle.read(tail, 0, tail.length, size - tail.length);
        try {
          const last = JSON.parse(tail.toString('utf8').trimEnd().split('\n').at(-1) ?? '');
          if (last?.type === 'truncated' && last.session === session) return;
        } catch { /* A damaged tail is separated from the next valid record below. */ }
        const separator = size && tail[tail.length - 1] !== 10 ? '\n' : '';
        const next = size + Buffer.byteLength(separator + line) > TEMP_MAX_BYTES ? marker : line;
        // Capacity check, marker deduplication and append share this session's write lock.
        await handle.writeFile(separator + next, 'utf8');
      } finally { await handle.close(); }
    });
  }

  async readTemp(session: string, options: { since?: number } = {}): Promise<TempRecord[]> {
    const name = sessionSegment(session);
    if (options.since !== undefined && (!Number.isFinite(options.since) || options.since < 0)) throw Error('Invalid memory since timestamp');
    return this.withReadLock(session, async () => {
      const directory = join(this.rootDir, 'temp', name);
      if (!await this.directoryExists(directory)) return [];
      const records: TempRecord[] = [];
      for (const file of (await readdir(directory)).filter(n => /^\d{4}-\d\d-\d\d\.jsonl$/.test(n)).sort()) {
        const path = join(directory, file);
        if (!await this.regularFile(path)) continue;
        for (const line of (await readFile(path, 'utf8')).split('\n')) {
          try {
            const record: unknown = JSON.parse(line);
            if (tempRecord(record, session) && (options.since === undefined || record.at >= options.since)) records.push(record);
          } catch { /* A partial or damaged JSONL line must not hide the rest of the file. */ }
        }
      }
      return records;
    });
  }

  /** Replace this entry id atomically, returning a basename accepted by readLong/removeLong. */
  async writeLong(scope: MemoryScope, entry: LongEntry): Promise<string> {
    const html = renderMemory(entry);
    const file = `${safeSegment(entry.id)}.html`;
    return this.withWriteLock(scope, async directory => {
      await this.directoryExists(directory, true);
      await atomicWrite(join(directory, file), html);
      storeState(directory).longVersion++;
      return file;
    });
  }

  private async longFiles(directory: string): Promise<string[]> {
    if (!await this.directoryExists(directory)) return [];
    return (await readdir(directory, { withFileTypes: true }))
      .filter(file => file.isFile() && /^[A-Za-z0-9._-][A-Za-z0-9:._-]*\.html$/.test(file.name))
      .map(file => file.name).sort();
  }

  async listLong(scope: MemoryScope): Promise<string[]> {
    return this.withReadLock(scope, directory => this.longFiles(directory));
  }

  /** Read the revision and all long HTML under one lock, never pairing old data with a new revision. */
  async snapshotLong(scope: MemoryScope): Promise<{ version: number; files: { name: string; html: string }[] }> {
    return this.withReadLock(scope, async directory => {
      const files: { name: string; html: string }[] = [];
      for (const name of await this.longFiles(directory)) {
        const path = join(directory, name);
        if (await this.regularFile(path)) files.push({ name, html: await readFile(path, 'utf8') });
      }
      return { version: storeState(directory).longVersion, files };
    });
  }

  /** Raw HTML supports both <memory> and the existing J3 <approval> schema. */
  async readLong(scope: MemoryScope, file: string): Promise<string | undefined> {
    longFile(file);
    return this.withReadLock(scope, async directory => {
      if (!await this.directoryExists(directory) || !await this.regularFile(join(directory, file))) return undefined;
      return readFile(join(directory, file), 'utf8');
    });
  }

  async removeLong(scope: MemoryScope, file: string): Promise<boolean> {
    longFile(file);
    return this.withWriteLock(scope, async directory => {
      if (!await this.directoryExists(directory) || !await this.regularFile(join(directory, file))) return false;
      await unlink(join(directory, file));
      storeState(directory).longVersion++;
      return true;
    });
  }
}
