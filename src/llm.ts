export interface OneShotOptions {
  provider: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  timeoutMs?: number;
  purpose?: string;
  signal?: AbortSignal;
}

interface LlmStream {
  stream(options: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
}

/** Collect one terminal response; a failed or incomplete response is never usable. */
export async function oneShot(llm: unknown, opts: OneShotOptions): Promise<string | null> {
  const controller = new AbortController();
  let iterator: AsyncIterator<Record<string, unknown>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const closeIterator = () => {
    const current = iterator;
    iterator = undefined;
    // An uncooperative generator can leave return() pending behind next().
    // Observe cleanup failures without making cleanup part of the deadline.
    if (current) void Promise.resolve().then(() => current.return?.()).catch(() => {});
  };

  try {
    if (!llm || typeof (llm as LlmStream).stream !== 'function' || opts.signal?.aborted) return null;
    const timeoutMs = opts.timeoutMs ?? 20_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
    const deadline = Date.now() + timeoutMs;
    const cancelled = new Promise<null>(resolve => {
      onAbort = () => { controller.abort(); resolve(null); };
      timer = setTimeout(onAbort, timeoutMs);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
    });

    const collect = async (): Promise<string | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (controller.signal.aborted || Date.now() >= deadline) return null;
        let text = '';
        let retry = false;
        try {
          iterator = (llm as LlmStream).stream({
            provider: opts.provider,
            model: opts.model,
            system: opts.system,
            messages: [{ role: 'user', content: [{ type: 'text', text: opts.prompt }] }],
            maxTokens: opts.maxTokens,
            purpose: opts.purpose ?? 'jarvis',
            signal: controller.signal,
            ...(attempt === 0 ? { reasoningEffort: 'low' } : {}),
          })[Symbol.asyncIterator]();
          while (!controller.signal.aborted && Date.now() < deadline) {
            const next = await iterator.next();
            if (controller.signal.aborted || Date.now() >= deadline || next.done) return null;
            const chunk = next.value;
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
            if (chunk.type !== 'finish') continue;
            const reason = chunk.reason as { kind?: string; failure?: { message?: unknown } } | undefined;
            const message = reason?.failure?.message;
            retry = attempt === 0 && reason?.kind === 'error'
              && typeof message === 'string' && message.includes('does not support reasoning effort');
            if (retry) break;
            if (!reason || reason.failure || !['stop', 'tool-calls', 'max-tokens'].includes(reason.kind ?? '')) return null;
            return text.trim() || null;
          }
        } finally {
          closeIterator();
        }
        if (!retry) return null;
      }
      return null;
    };

    // Racing the whole operation also bounds adapters that ignore AbortSignal.
    // Promise.race observes late rejections from a cancelled iterator.
    return await Promise.race([collect(), cancelled]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
    controller.abort();
    closeIterator();
  }
}
