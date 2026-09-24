import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isNarration, type Narration } from './narration.ts';

/** Sessions handed to Jarvis (SPEC §9.2): the only ones it may inject into.
 *  Persisted as a JSON array of session ids, or `{ managed, narration }` once a
 *  session overrides the narration default; a write failure keeps the change
 *  in memory for this run rather than failing the caller. */
export class ManagedSet implements Iterable<string> {
  private readonly ids: Set<string>;
  private readonly overrides: Map<string, Narration>;
  private readonly file: string;
  private readonly onError: (e: unknown) => void;

  constructor(file: string, onError: (e: unknown) => void = () => {}) {
    this.file = file;
    this.onError = onError;
    const saved = readSaved(file);
    this.ids = new Set(saved.ids);
    this.overrides = new Map(saved.narration.filter(([id]) => this.ids.has(id)));
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

  /** Releasing a session forgets its narration override too. @returns whether the set changed. */
  remove(id: string): boolean {
    if (!this.ids.delete(id)) return false;
    this.overrides.delete(id);
    this.save();
    return true;
  }

  narration(id: string): Narration | undefined { return this.overrides.get(id); }

  /** `undefined` clears the override. Only managed sessions carry one. @returns whether it changed. */
  setNarration(id: string, narration: Narration | undefined): boolean {
    if (!this.ids.has(id) || (narration !== undefined && !isNarration(narration))) return false;
    if (this.overrides.get(id) === narration) return false;
    if (narration === undefined) this.overrides.delete(id);
    else this.overrides.set(id, narration);
    this.save();
    return true;
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      const ids = [...this.ids];
      const body = this.overrides.size === 0 ? ids : { managed: ids, narration: Object.fromEntries(this.overrides) };
      writeFileSync(tmp, JSON.stringify(body, null, 2));
      renameSync(tmp, this.file);
    } catch (e) { this.onError(e); }
  }
}

/** Accepts `["id", …]` or `{ "managed": ["id", …], "narration": { id: mode } }`; anything else reads as empty. */
function readSaved(file: string): { ids: string[]; narration: [string, Narration][] } {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return { ids: [], narration: [] }; }
  const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { managed?: unknown; narration?: unknown } : undefined;
  const list = Array.isArray(raw) ? raw : object?.managed;
  const ids = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  const map = object?.narration && typeof object.narration === 'object' && !Array.isArray(object.narration)
    ? Object.entries(object.narration as Record<string, unknown>) : [];
  return { ids, narration: map.filter((entry): entry is [string, Narration] => isNarration(entry[1])) };
}
