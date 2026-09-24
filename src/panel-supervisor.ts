export type PanelExitDecision =
  | { action: 'respawn'; delayMs: number }
  | { action: 'stay-down'; reason: 'disposed' | 'clean-exit' | 'crash-limit' | 'stopped' };

const crashWindowMs = 10 * 60 * 1000;
const retryDelaysMs = [1000, 5000, 30000];

/** Pure restart policy. markStarted is called on spawn, so backoff is never uptime. */
export class PanelSupervisor {
  private now: () => number;
  private crashes: number[] = [];
  private startedAt: number | null = null;
  private disposed = false;
  private stopped = false;

  constructor(now: () => number = Date.now) { this.now = now; }

  markStarted(): void {
    if (!this.disposed && !this.stopped) this.startedAt = this.now();
  }

  markDisposed(): void { this.disposed = true; }

  onExit(code: number | null, _signal: string | null): PanelExitDecision {
    if (this.disposed) return { action: 'stay-down', reason: 'disposed' };
    if (this.stopped) return { action: 'stay-down', reason: 'stopped' };
    if (code === 0) return { action: 'stay-down', reason: 'clean-exit' };
    const now = this.now();
    if (this.startedAt !== null && now - this.startedAt >= crashWindowMs) this.crashes = [];
    this.startedAt = null;
    this.crashes = this.crashes.filter(at => now - at < crashWindowMs);
    this.crashes.push(now);
    if (this.crashes.length > retryDelaysMs.length) {
      this.stopped = true;
      return { action: 'stay-down', reason: 'crash-limit' };
    }
    return { action: 'respawn', delayMs: retryDelaysMs[this.crashes.length - 1] };
  }
}
