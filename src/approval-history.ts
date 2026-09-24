import type { MemoryStore } from './memory/store.ts';
import { parseApprovalRecord } from './memory/approval.ts';
import { fingerprint, type ApprovalRecord } from './approvals.ts';
export interface ApprovalHistory { approvals: number; denials: number; complete: boolean; records: unknown[] }
export async function readApprovalHistory(store: MemoryStore, operation: {tool: string;command: string;args?: string;cwd: string}): Promise<ApprovalHistory> {
  const result: ApprovalHistory = { approvals: 0, denials: 0, complete: true, records: [] };
  const matching: ApprovalRecord[] = [];
  const fp = fingerprint(operation.tool, operation.command);
  // One coherent snapshot: a denied request cannot disappear between list/read calls.
  const { files } = await store.snapshotLong('approvals');
  for (const { html } of files) {
    const record = parseApprovalRecord(html);
    if (!record) { result.complete = false; continue; }
    if (record.fingerprint !== fp || record.operation.tool !== operation.tool || record.session.cwd !== operation.cwd) continue;
    matching.push(record);
    if (record.decision.source !== 'user') continue;
    // A denial for any colliding fingerprint vetoes learned approval. Positive
    // evidence must also match the raw operation; J3's fingerprint is lossy.
    if (!record.decision.allow) result.denials++;
    else if (record.operation.command === operation.command && record.operation.args === (operation.args ?? '')) result.approvals++;
  }
  result.records = matching.sort((a,b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 10);
  return result;
}
