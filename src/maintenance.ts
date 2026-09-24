export interface CacheFile { name: string; mtimeMs?: number }
export interface CachePolicy { maxAgeDays: number; keep: number }

export function shouldRotate(size: number, limit = 1_048_576): boolean {
  return Number.isFinite(size) && Number.isFinite(limit) && limit >= 0 && size > limit;
}

export function cacheVictims(files: readonly CacheFile[], now: number, policy: CachePolicy): string[] {
  if (!Number.isFinite(now) || !Number.isFinite(policy.maxAgeDays) || policy.maxAgeDays < 0 ||
      !Number.isSafeInteger(policy.keep) || policy.keep < 0) return [];
  const candidates = files.filter((file): file is CacheFile & { mtimeMs: number } =>
    /^say-[^/\\]+\.mp3$/.test(file.name) && typeof file.mtimeMs === 'number' && Number.isFinite(file.mtimeMs))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const cutoff = now - policy.maxAgeDays * 86_400_000;
  return candidates.filter((file, index) => file.mtimeMs < cutoff || index >= policy.keep).map(file => file.name);
}
