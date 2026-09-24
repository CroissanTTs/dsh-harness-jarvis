export interface ApprovalRecord {
  fingerprint: string;
  ts: string;
  session: { id: string; cwd: string; managed: boolean };
  operation: { tool: string; command: string; args: string };
  context: string;
  decision: { allow: boolean; source: string; reason: string };
  tier: { value: string; notes: string };
}
const safe = (value: string): string => value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');

export function fingerprint(tool: string, command?: string): string {
  const words = (command ?? '').trim().split(/\s+/).slice(0, 8).map(word =>
    /^[\/~]/.test(word) ? word.replace(/\/+$/, '').split('/').pop() ?? '' : word);
  return `${safe(tool)}:${safe(words.join('-'))}`;
}

function escapeHtml(value: string | boolean): string {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

export function renderApprovalHtml(record: ApprovalRecord): string {
  const e = escapeHtml;
  const { session, operation, decision, tier } = record;
  return `<approval fingerprint="${e(record.fingerprint)}" ts="${e(record.ts)}">
  <session id="${e(session.id)}" cwd="${e(session.cwd)}" managed="${e(session.managed)}">${e(session.id)} — ${e(session.cwd)}</session>
  <operation tool="${e(operation.tool)}" command="${e(operation.command)}" args="${e(operation.args)}">${e(operation.tool)}: ${e(operation.command)}</operation>
  <context>${e(record.context)}</context>
  <decision allow="${e(decision.allow)}" source="${e(decision.source)}" reason="${e(decision.reason)}">${decision.allow ? '批准' : '拒绝'}</decision>
  <tier value="${e(tier.value)}" notes="${e(tier.notes)}" />
</approval>
`;
}

export function approvalFileName(fp: string, ts: string): string {
  const stamp = new Date(ts).toISOString().slice(0, 19).replace(/[-:]/g, '');
  const stem = fp.toLowerCase().replace(/[^a-z0-9:._-]+/g, '-').replace(/^[.:-]+/, '').slice(0, 160) || 'approval';
  return `${stem}-${stamp}.html`;
}

/** Keep the raw operation for memory; only the panel display is shortened. */
export function approvalOperation(messages: any[], callId: unknown): { command: string; args: string } {
  if (callId !== undefined) {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const block of messages[i]?.content ?? []) {
        if ((block?.type !== 'toolCall' && block?.type !== 'tool_call') || block?.id !== callId) continue;
        let args: any = block.arguments ?? block.input;
        const raw = typeof args === 'string' ? args : JSON.stringify(args ?? '');
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { return { command: args, args: raw }; }
        }
        return { command: typeof args?.command === 'string' ? args.command
          : typeof args?.path === 'string' ? args.path : raw, args: raw };
      }
    }
  }
  return { command: '', args: '' };
}
