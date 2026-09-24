/** A searchable projection of J3's existing HTML, without changing its stored schema. */
import type { ApprovalRecord } from '../approvals.ts';
export interface ApprovalMemory { tag: string; key: string; detail: string; session: string; created: string }
function decode(value: string): string {
  if (/[<>]/.test(value) || /&(?!(?:amp|lt|gt|quot|#39);)/.test(value)) throw Error('Invalid approval escaping');
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]!);
}
function attrs(raw: string, required: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  while (raw.trim()) {
    const match = /^\s+([a-z]+)="([^"]*)"/.exec(raw);
    if (!match || !required.includes(match[1]) || Object.hasOwn(result, match[1])) throw Error('Invalid approval attributes');
    result[match[1]] = decode(match[2]); raw = raw.slice(match[0].length);
  }
  if (!required.every(name => Object.hasOwn(result, name))) throw Error('Missing approval attributes');
  return result;
}
export function parseApprovalRecord(html: string): ApprovalRecord | undefined {
  try {
    const match = /^\s*<approval(\s[^<>]*?)>\s*<session(\s[^<>]*?)>([^<>]*)<\/session>\s*<operation(\s[^<>]*?)>([^<>]*)<\/operation>\s*<context>([^<>]*)<\/context>\s*<decision(\s[^<>]*?)>([^<>]*)<\/decision>\s*<tier(\s[^<>]*?)\/>\s*<\/approval>\s*$/.exec(html);
    if (!match) return undefined;
    const head = attrs(match[1], ['fingerprint', 'ts']);
    const session = attrs(match[2], ['id', 'cwd', 'managed']);
    const operation = attrs(match[4], ['tool', 'command', 'args']);
    const decision = attrs(match[7], ['allow', 'source', 'reason']);
    const tier = attrs(match[9], ['value', 'notes']);
    for (const i of [3, 5, 8]) decode(match[i]);
    if (!/^\d{4}-\d\d-\d\dT/.test(head.ts) || !Number.isFinite(Date.parse(head.ts)) ||
      !['true', 'false'].includes(decision.allow) || !['true', 'false'].includes(session.managed)) return undefined;
    return { fingerprint: head.fingerprint, ts: head.ts,
      session: { id: session.id, cwd: session.cwd, managed: session.managed === 'true' },
      operation: { tool: operation.tool, command: operation.command, args: operation.args }, context: decode(match[6]),
      decision: { allow: decision.allow === 'true', source: decision.source, reason: decision.reason },
      tier: { value: tier.value, notes: tier.notes } };
  } catch { return undefined; }
}

export function approvalMemory(html: string): ApprovalMemory | undefined {
  const record = parseApprovalRecord(html);
  if (!record) return undefined;
  const { operation, decision } = record;
  const summary = `${decision.allow ? '批准' : '拒绝'} ${operation.tool}: ${operation.command}`;
  return { tag: '审批', key: Array.from(summary).slice(0, 160).join(''), session: record.session.id,
    created: record.ts, detail: [record.fingerprint, operation.command, operation.args, record.context, decision.reason].join(' ') };
}
