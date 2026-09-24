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

const locks = new Map<string, ReadWriteLock>();
export function storeLock(directory: string): ReadWriteLock {
  // Conservative case folding also serializes aliases on default macOS/Windows volumes.
  const key = process.platform === 'darwin' || process.platform === 'win32' ? directory.toLowerCase() : directory;
  let lock = locks.get(key);
  if (!lock) { lock = new ReadWriteLock(); locks.set(key, lock); }
  return lock;
}
