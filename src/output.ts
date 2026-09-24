interface Clock {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}
interface Dependencies {
  say: (text: string) => unknown | Promise<unknown>;
  managed?: (session: string) => boolean;
  clock?: Clock;
}
interface Question {
  session?: string;
  run: () => Promise<void>;
  discard: () => void;
  cleanup: () => void;
}
interface Announcement {
  title: string;
  text: string;
  waiters: { resolve: () => void; reject: (error: unknown) => void }[];
}

/** Completion batching and user questions have independent lifetimes. */
export class OutputCoordinator {
  private readonly deps: Dependencies;
  private readonly clock: Clock;
  private readonly announcements = new Map<string, Announcement>();
  private timer: unknown;
  private questions: Question[] = [];
  private asking = false;
  private disposed = false;

  constructor(deps: Dependencies) {
    this.deps = deps;
    this.clock = deps.clock ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
    };
  }

  async announce(session: string, text: string, options: { title?: string; immediate?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    if (options.immediate) { await this.deps.say(text); return; }
    return new Promise<void>((resolve, reject) => {
      const previous = this.announcements.get(session);
      this.announcements.set(session, {
        title: options.title ?? session, text,
        waiters: [...(previous?.waiters ?? []), { resolve, reject }],
      });
      if (this.timer === undefined) this.timer = this.clock.setTimeout(() => this.flush(), 1500);
    });
  }

  private flush(): void {
    this.timer = undefined;
    const batch = [...this.announcements.values()];
    this.announcements.clear();
    if (!batch.length) return;
    const text = batch.length === 1 ? batch[0].text
      : batch.length === 2 ? `${batch[0].title} 和 ${batch[1].title} 都做完了`
      : `${batch[0].title}、${batch[1].title} 等 ${batch.length} 个会话做完了`;
    void Promise.resolve().then(() => { if (!this.disposed) return this.deps.say(text); }).then(
      () => batch.forEach(item => item.waiters.forEach(waiter => waiter.resolve())),
      error => batch.forEach(item => item.waiters.forEach(waiter => waiter.reject(error))),
    );
  }

  ask<T>(fn: () => T | Promise<T>, options: { session?: string; signal?: AbortSignal } = {}): Promise<T | undefined> {
    if (this.disposed || options.signal?.aborted) return Promise.resolve(undefined);
    return new Promise<T | undefined>((resolve, reject) => {
      const question: Question = {
        session: options.session,
        run: async () => {
          try { resolve(await fn()); } catch (error) { reject(error); }
        },
        discard: () => resolve(undefined),
        cleanup: () => options.signal?.removeEventListener('abort', abort),
      };
      const abort = () => this.discardQueued(item => item === question);
      options.signal?.addEventListener('abort', abort, { once: true });
      this.questions.push(question);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.asking) return;
    this.asking = true;
    try {
      while (!this.disposed && this.questions.length) {
        const question = this.questions.shift()!;
        question.cleanup();
        if (question.session !== undefined && this.deps.managed && !this.deps.managed(question.session)) {
          question.discard();
        } else {
          await question.run();
        }
      }
    } finally { this.asking = false; }
  }

  private discardQueued(predicate: (question: Question) => boolean): void {
    this.questions = this.questions.filter(question => {
      if (!predicate(question)) return true;
      question.cleanup();
      question.discard();
      return false;
    });
  }

  dropSession(session: string): void {
    this.discardQueued(question => question.session === session);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    for (const item of this.announcements.values()) item.waiters.forEach(waiter => waiter.resolve());
    this.announcements.clear();
    this.discardQueued(() => true);
  }
}
