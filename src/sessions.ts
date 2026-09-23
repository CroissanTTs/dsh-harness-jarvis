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

/** Folder name of a session's working directory, used to tell same-titled sessions apart. */
export function workspaceName(cwd: unknown): string | undefined {
  if (typeof cwd !== 'string') return undefined;
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}
