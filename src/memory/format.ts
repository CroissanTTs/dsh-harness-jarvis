export interface LongEntry {
  id: string;
  tag: string;
  intent?: string;
  session?: string;
  created: string;
  expires?: string;
  source: 'remember' | 'classifier' | 'consolidate';
  key: string;
  detail?: string;
  ref?: { session: string; turn?: string };
}
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const decode = (text: string): string => {
  if (/[<>]/.test(text) || /&(?!(?:amp|lt|gt|quot|#39);)/.test(text)) throw Error('Invalid memory escaping');
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!);
};
const iso = (text: string) => /^\d{4}-\d\d-\d\dT/.test(text) && Number.isFinite(Date.parse(text));
function validate(entry: LongEntry): void {
  if (!entry || !['id', 'tag', 'created', 'source', 'key'].every(key => typeof (entry as any)[key] === 'string') ||
    !entry.id.trim() || !entry.key.trim() || !iso(entry.created) ||
    !['remember', 'classifier', 'consolidate'].includes(entry.source)) throw Error('Invalid long memory entry');
  for (const key of ['intent', 'session', 'expires', 'detail'] as const) {
    if (entry[key] !== undefined && typeof entry[key] !== 'string') throw Error(`Invalid memory ${key}`);
  }
  if (entry.expires && !iso(entry.expires)) throw Error('Invalid memory expiration');
  if (entry.ref !== undefined && (!entry.ref || typeof entry.ref.session !== 'string' ||
    (entry.ref.turn !== undefined && typeof entry.ref.turn !== 'string'))) throw Error('Invalid memory reference');
}
const attrs = (values: Record<string, string | undefined>) => Object.entries(values)
  .filter(([, value]) => value !== undefined).map(([key, value]) => `${key}="${escape(value!)}"`).join(' ');

export function renderMemory(entry: LongEntry): string {
  validate(entry);
  return `<memory ${attrs({ id: entry.id, tag: entry.tag, intent: entry.intent, session: entry.session,
    created: entry.created, expires: entry.expires, source: entry.source })}>\n` +
    `  <key>${escape(entry.key)}</key>\n` +
    (entry.detail === undefined ? '' : `  <detail>${escape(Array.from(entry.detail).slice(0, 500).join(''))}</detail>\n`) +
    (entry.ref === undefined ? '' : `  <ref ${attrs(entry.ref)}/>\n`) + '</memory>\n';
}

function attributes(raw: string, allowed: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  let rest = raw;
  while (rest.trim()) {
    const match = /^\s+([a-z]+)="([^"]*)"/.exec(rest);
    if (!match || !allowed.includes(match[1]) || Object.hasOwn(values, match[1])) throw Error('Invalid memory attributes');
    values[match[1]] = decode(match[2]); rest = rest.slice(match[0].length);
  }
  return values;
}

/** Parse only the memory schema; malformed files (including approval HTML) are skipped. */
export function parseMemory(html: string): LongEntry | undefined {
  try {
    if (typeof html !== 'string') return undefined;
    const match = /^\s*<memory(\s[^<>]*?)>\s*<key>([^<>]*)<\/key>\s*(?:<detail>([^<>]*)<\/detail>\s*)?(?:<ref(\s[^<>]*?)\/>\s*)?<\/memory>\s*$/.exec(html);
    if (!match) return undefined;
    const value = attributes(match[1], ['id', 'tag', 'intent', 'session', 'created', 'expires', 'source']);
    const entry = { ...value, key: decode(match[2]),
      ...(match[3] === undefined ? {} : { detail: decode(match[3]) }),
      ...(match[4] === undefined ? {} : { ref: attributes(match[4], ['session', 'turn']) }),
    } as unknown as LongEntry;
    validate(entry);
    if (entry.detail !== undefined && Array.from(entry.detail).length > 500) return undefined;
    return entry;
  } catch { return undefined; }
}
