import { randomUUID } from 'node:crypto';
import { MemoryStore, parseMemory, type LongEntry } from './store.ts';
import { approvalMemory } from './approval.ts';

export interface RememberArgs { content: string; tag?: string; session?: string; expiresDays?: number }
export interface RecallArgs { query: string; session?: string; limit?: number }
const DAY = 86_400_000;
const EMPTY = '没有找到相关记忆';
const singleLine = (value: string) => value.replace(/\s+/g, ' ').trim();
function required(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${name} must not be empty`);
  return value.trim();
}
function scopeFor(session?: string): string {
  if (session === undefined) return 'general';
  if (typeof session !== 'string') throw Error('session must be a string');
  if (!session.trim()) return 'general';
  if (session === 'approvals') throw Error('approvals is not a session');
  return session;
}
/** English periods end sentences only before whitespace/end; preserve decimals and filenames. */
function splitContent(content: string): { key: string; detail?: string } {
  const end = /[。！？!?]+[”’"'」』]*|\.[”’"'」』]*(?=\s|$)|\r?\n/.exec(content);
  if (!end) return { key: content };
  const boundary = end.index + end[0].length;
  const detail = content.slice(boundary).trim();
  return { key: content.slice(0, boundary).trim(), ...(detail ? { detail } : {}) };
}

export async function remember(store: MemoryStore, args: RememberArgs, now = Date.now()): Promise<string> {
  const content = required(args.content, 'remember: content');
  const scope = scopeFor(args.session);
  if (args.tag !== undefined && typeof args.tag !== 'string') throw Error('remember: tag must be a string');
  const days = args.expiresDays;
  const expiration = days === undefined ? undefined : now + days * DAY;
  if (days !== undefined && (typeof days !== 'number' || !Number.isFinite(days) || days < 0 ||
    !Number.isFinite(new Date(expiration!).getTime()))) throw Error('remember: invalid expiresDays');
  await store.writeLong(scope, {
    id: randomUUID(), tag: args.tag?.trim() || 'note', source: 'remember', created: new Date(now).toISOString(),
    ...(scope === 'general' ? {} : { session: scope }),
    ...(expiration === undefined ? {} : { expires: new Date(expiration).toISOString() }),
    ...splitContent(content),
  });
  return '记住了';
}

function tokens(query: string): string[] {
  return [...new Set(query.toLowerCase().replace(/(\p{Script=Han})/gu, ' $1 ').match(/[\p{L}\p{N}_-]+/gu) ?? [])];
}
function score(words: string[], entry: Pick<LongEntry, 'key' | 'tag' | 'detail'>): number {
  const key = entry.key.toLowerCase(), tag = entry.tag.toLowerCase(), detail = (entry.detail ?? '').toLowerCase();
  return words.reduce((sum, word) => sum + (key.includes(word) ? 3 : 0) + (tag.includes(word) ? 2 : 0) + (detail.includes(word) ? 1 : 0), 0);
}
export function scoreMemory(query: string, entry: Pick<LongEntry, 'key' | 'tag' | 'detail'>): number {
  return score(tokens(query), entry);
}

/** Only key + source/date leave the store; detail contributes to ranking but is never returned. */
export async function recall(store: MemoryStore, args: RecallArgs, now = Date.now()): Promise<string> {
  const query = required(args.query, 'recall: query');
  const session = scopeFor(args.session);
  if (args.limit !== undefined && (typeof args.limit !== 'number' || !Number.isFinite(args.limit))) throw Error('recall: invalid limit');
  const limit = Math.max(0, Math.min(10, Math.floor(args.limit ?? 5)));
  const words = tokens(query);
  if (!limit || !words.length) return EMPTY;
  const scopes = ['general', ...(session === 'general' ? [] : [session]), ...(/审批|批准|拒绝/.test(query) ? ['approvals'] : [])];
  const results: { key: string; tag: string; source: string; created: number; score: number; file: string }[] = [];
  for (const scope of scopes) {
    for (const file of await store.listLong(scope)) {
      let html: string | undefined;
      try { html = await store.readLong(scope, file); } catch { continue; }
      if (html === undefined) continue;
      const entry = parseMemory(html) ?? (scope === 'approvals' ? approvalMemory(html) : undefined);
      if (!entry || ('expires' in entry && entry.expires && Date.parse(entry.expires) <= now)) continue;
      const points = score(words, entry);
      if (!points) continue;
      results.push({ key: entry.key, tag: entry.tag, source: scope === 'approvals' ? entry.session || 'approvals' : scope,
        created: Date.parse(entry.created), score: points, file });
    }
  }
  results.sort((a, b) => b.score - a.score || b.created - a.created || a.source.localeCompare(b.source) || a.file.localeCompare(b.file));
  return results.slice(0, limit).map(entry => `- [${singleLine(entry.tag)}] ${singleLine(entry.key)}（来源：${singleLine(entry.source)}，${new Date(entry.created).toISOString().slice(0, 10)}）`).join('\n') || EMPTY;
}
