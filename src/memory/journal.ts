import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function atomicWrite(file: string, text: string): Promise<void> {
  const temporary = join(dirname(file), `.memory-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}

interface Writing { store: string; startedAt: number }

/** Diagnostic journal only: never a cross-process lock or permission to write. */
export class WriteJournal {
  readonly ready: Promise<void>;
  private file: string;
  private active = new Map<symbol, Writing>();
  private tail: Promise<void>;
  private report: (error: unknown) => void;

  constructor(file: string, now: number, onError: (error: unknown) => void) {
    this.file = file;
    this.report = error => { try { onError(error); } catch {} };
    this.ready = this.recover(now).catch(this.report);
    this.tail = this.ready;
  }

  async begin(store: string, startedAt: number): Promise<symbol> {
    const key = Symbol();
    await this.update(() => { this.active.set(key, { store, startedAt }); });
    return key;
  }

  end(key: symbol): Promise<void> { return this.update(() => { this.active.delete(key); }); }

  private update(change: () => void): Promise<void> {
    this.tail = this.tail.then(async () => {
      change();
      await this.persist([...this.active.values()]);
    }).catch(this.report);
    return this.tail;
  }

  private async persist(writes: Writing[]): Promise<void> {
    if (!writes.length) {
      await unlink(this.file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    } else {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      await atomicWrite(this.file, JSON.stringify({ writes }, null, 2) + '\n');
    }
  }

  private async recover(now: number): Promise<void> {
    let text: string;
    try { text = await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    let writes: Writing[];
    try {
      const raw = JSON.parse(text);
      writes = Array.isArray(raw?.writes) ? raw.writes : [raw];
      if (!writes.every(w => w && typeof w.store === 'string' &&
        Number.isFinite(w.startedAt) && w.startedAt >= 0)) throw Error('Invalid memory lock journal');
    } catch (error) { this.report(error); await this.persist([]); return; }
    const fresh = writes.filter(w => now - w.startedAt <= 60_000);
    if (fresh.length !== writes.length) await this.persist(fresh);
  }
}

const journals = new Map<string, WriteJournal>();
export function writeJournal(file: string, now: number, onError: (error: unknown) => void): WriteJournal {
  const key = process.platform === 'darwin' || process.platform === 'win32' ? file.toLowerCase() : file;
  let journal = journals.get(key);
  if (!journal) { journal = new WriteJournal(file, now, onError); journals.set(key, journal); }
  return journal;
}
