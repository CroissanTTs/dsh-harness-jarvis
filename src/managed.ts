import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Sessions handed to Jarvis (SPEC §9.2): the only ones it may inject into.
 *  Persisted as a JSON array of session ids; a write failure keeps the change
 *  in memory for this run rather than failing the caller. */
export class ManagedSet implements Iterable<string> {
  private readonly ids: Set<string>;
  private readonly file: string;
  private readonly onError: (e: unknown) => void;

  constructor(file: string, onError: (e: unknown) => void = () => {}) {
    this.file = file;
    this.onError = onError;
    this.ids = new Set(readIds(file));
  }

  has(id: string): boolean { return this.ids.has(id); }

  list(): string[] { return [...this.ids]; }

  [Symbol.iterator](): Iterator<string> { return this.ids[Symbol.iterator](); }

  /** @returns whether the set changed. */
  add(id: string): boolean {
    if (!id || this.ids.has(id)) return false;
    this.ids.add(id);
    this.save();
    return true;
  }

  /** @returns whether the set changed. */
  remove(id: string): boolean {
    if (!this.ids.delete(id)) return false;
    this.save();
    return true;
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify([...this.ids], null, 2));
      renameSync(tmp, this.file);
    } catch (e) { this.onError(e); }
  }
}

/** Accepts `["id", …]` or `{ "managed": ["id", …] }`; anything else reads as empty. */
function readIds(file: string): string[] {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
  const list = Array.isArray(raw) ? raw : (raw as { managed?: unknown } | null)?.managed;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}
