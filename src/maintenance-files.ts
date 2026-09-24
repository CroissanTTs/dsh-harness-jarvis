import { appendFileSync, lstatSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cacheVictims, shouldRotate } from './maintenance.ts';

export class RotatingLog {
  private path: string;
  private writes = 0;

  constructor(path: string) { this.path = path; }

  write(line: string): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      appendFileSync(this.path, line);
      this.writes = (this.writes + 1) % 100;
      if (this.writes === 0 && shouldRotate(statSync(this.path).size)) {
        renameSync(this.path, this.path + '.1');
      }
    } catch { /* Diagnostics must never interrupt the plugin. */ }
  }
}

export function cleanupSpeechCache(dir: string, now = Date.now()): void {
  try {
    const files = readdirSync(dir).flatMap(name => {
      if (!/^say-[^/\\]+\.mp3$/.test(name)) return [];
      try {
        const stat = lstatSync(join(dir, name));
        return stat.isFile() ? [{ name, mtimeMs: stat.mtimeMs }] : [];
      } catch { return []; }
    });
    for (const name of cacheVictims(files, now, { maxAgeDays: 7, keep: 100 })) {
      try { unlinkSync(join(dir, name)); } catch { /* Other files can still be cleaned. */ }
    }
  } catch { /* Missing or unreadable cache directories are harmless. */ }
}
