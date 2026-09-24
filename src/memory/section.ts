import { MemoryStore, parseMemory, type LongEntry } from './store.ts';

const HEADER = '## 长期记忆';
/** Stable newest-first ordering; no query, detail, tags or per-session content enters L1. */
export function renderMemorySection(entries: LongEntry[], now = Date.now()): string {
  const latest = entries.filter(entry => entry.key.trim() && (!entry.expires || Date.parse(entry.expires) > now))
    .sort((a, b) => Date.parse(b.created) - Date.parse(a.created) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 20);
  if (!latest.length) return '';
  let result = HEADER, count = Array.from(HEADER).length;
  for (const entry of latest) {
    const room = 1500 - count - 3; // newline + bullet + space
    if (room <= 0) break;
    const key = Array.from(entry.key.replace(/\s+/g, ' ').trim()).slice(0, room).join('');
    result += `\n- ${key}`;
    count += 3 + Array.from(key).length;
  }
  return result;
}

/** The host's section provider is synchronous; its assembly hook awaits refresh first. */
export class MemorySection {
  private store: MemoryStore;
  private cachedVersion = -1;
  private cachedText = '';
  private pending?: Promise<string>;
  private now: () => number;
  private onError: (error: unknown) => void;

  constructor(store: MemoryStore, options: { now?: () => number; onError?: (error: unknown) => void } = {}) {
    this.store = store;
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => {});
  }

  text(): string { return this.cachedText; }

  refresh(): Promise<string> {
    if (this.store.version() === this.cachedVersion) return Promise.resolve(this.cachedText);
    if (!this.pending) this.pending = this.rebuild().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async rebuild(): Promise<string> {
    try {
      const snapshot = await this.store.snapshotLong('general');
      const entries = snapshot.files.flatMap(file => {
        const entry = parseMemory(file.html);
        return entry ? [entry] : [];
      });
      this.cachedText = renderMemorySection(entries, this.now());
      this.cachedVersion = snapshot.version;
    } catch (error) { try { this.onError(error); } catch { /* Prompt assembly must survive logging failure. */ } }
    return this.cachedText;
  }
}
