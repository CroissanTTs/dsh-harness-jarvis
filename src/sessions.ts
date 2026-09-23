/** Which DSH sessions the panel lists as send targets. No DSH imports. */

/** Live agent ids minus Jarvis itself and every session archived in DSH, deduped, in registry order. */
export function visibleWorkers(ids: Iterable<unknown>, exclude: Iterable<unknown>): string[] {
  const skip = new Set<string>();
  for (const id of exclude) if (typeof id === 'string' && id) skip.add(id);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw : '';
    if (!id || skip.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export type Delivery = 'followup' | 'steer' | 'inject';

/** Hands a message to a session so it actually acts on it: an idle agent gets
 *  a new turn (`followup`), a running one takes it at its next step (`steer`).
 *  Plain `inject` only queues without waking, so it is the last resort.
 *  @returns how it was delivered, or null when the agent takes no messages. */
export function deliver(agent: unknown, message: unknown): Delivery | null {
  const a = agent as { status?: unknown; followup?: unknown; steer?: unknown; inject?: unknown } | null;
  if (!a) return null;
  const call = (kind: Delivery): Delivery | null => {
    const fn = a[kind];
    if (typeof fn !== 'function') return null;
    fn.call(a, message);
    return kind;
  };
  const preferred: Delivery[] = a.status === 'running' ? ['steer', 'followup'] : ['followup', 'steer'];
  for (const kind of [...preferred, 'inject' as const]) {
    const done = call(kind);
    if (done) return done;
  }
  return null;
}

/** Folder name of a session's working directory, used to tell same-titled sessions apart. */
export function workspaceName(cwd: unknown): string | undefined {
  if (typeof cwd !== 'string') return undefined;
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}
