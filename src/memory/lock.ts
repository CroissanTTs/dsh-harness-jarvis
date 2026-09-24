/** Process-local, non-reentrant writer-priority lock. */
export class ReadWriteLock {
  private readers = 0;
  private writing = false;
  private reads: (() => void)[] = [];
  private writes: (() => void)[] = [];

  run<T>(write: boolean, fn: () => T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        if (write) this.writing = true; else this.readers++;
        const release = () => {
          if (write) this.writing = false; else this.readers--;
          this.drain();
        };
        Promise.resolve().then(fn).then(
          value => { release(); resolve(value); },
          error => { release(); reject(error); },
        );
      };
      (write ? this.writes : this.reads).push(start);
      this.drain();
    });
  }

  private drain(): void {
    if (this.writing) return;
    if (this.writes.length) {
      if (!this.readers) this.writes.shift()!();
    } else {
      for (const start of this.reads.splice(0)) start();
    }
  }
}

interface StoreState { lock: ReadWriteLock; longVersion: number }
const stores = new Map<string, StoreState>();
export function storeState(directory: string): StoreState {
  // Conservative case folding also serializes aliases on default macOS/Windows volumes.
  const key = process.platform === 'darwin' || process.platform === 'win32' ? directory.toLowerCase() : directory;
  let state = stores.get(key);
  if (!state) { state = { lock: new ReadWriteLock(), longVersion: 0 }; stores.set(key, state); }
  return state;
}
export function storeLock(directory: string): ReadWriteLock { return storeState(directory).lock; }
