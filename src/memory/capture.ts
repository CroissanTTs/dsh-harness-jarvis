import type { MemoryStore, TempInput } from './store.ts';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const blocks = (message: unknown): unknown[] => {
  const content = object(message).content;
  return Array.isArray(content) ? content : [];
};
function prefix(text: string, limit: number): string {
  let result = '', count = 0;
  for (const char of text) { if (count++ === limit) break; result += char; }
  return result;
}

/** Whitelist projection of committed DSH events. No recursive text traversal or payload copying. */
export function toTempRecord(event: unknown, toolName?: string): TempInput | null {
  const e = object(event), data = object(e.data), at = e.time;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > Date.UTC(9999, 11, 31, 23, 59, 59, 999)) return null;
  switch (e.type) {
    case 'user/message': {
      let text = '';
      for (const value of blocks(data)) {
        const block = object(value);
        if (block.type !== 'text' || typeof block.text !== 'string' || !block.text) continue;
        text = prefix(text + (text ? '\n' : '') + prefix(block.text, 500), 500);
        if (Array.from(text).length >= 500) break;
      }
      return text.trim() ? { at, type: e.type, text } : null;
    }
    case 'assistant/message': {
      if (data.interrupted === true) return null;
      const content = blocks(data.message);
      for (let i = content.length - 1; i >= 0; i--) {
        const block = object(content[i]);
        if (block.type !== 'text' || typeof block.text !== 'string') continue;
        const text = prefix(block.text, 800);
        return text.trim() ? { at, type: e.type, text } : null;
      }
      return null;
    }
    case 'tool/result': {
      const content = blocks(data.message);
      const block = object(content[0]);
      if (!toolName?.trim() || content.length !== 1 || block.type !== 'tool-result' ||
        (block.isError !== undefined && typeof block.isError !== 'boolean')) return null;
      return { at, type: e.type, tool: toolName, isError: block.isError === true };
    }
    case 'turn/end': {
      const reason = object(data.reason).kind;
      return typeof reason === 'string' && reason.trim() ? { at, type: e.type, reason } : null;
    }
    default: return null;
  }
}

export interface CaptureSession { id: string; eventAt?: (seq: number) => unknown }
/** tool/result carries callId only; the committed tool/call owns the tool's name. */
function resultToolName(session: CaptureSession, event: ObjectValue): string | undefined {
  if (event.type !== 'tool/result' || !Number.isSafeInteger(event.seq) || !session.eventAt) return;
  const message = object(object(event.data).message);
  const callId = object(message.source).callId;
  if (typeof callId !== 'string' || !callId || object(blocks(message)[0]).toolCallId !== callId) return;
  for (let seq = (event.seq as number) - 1; seq >= 0; seq--) {
    const prior = object(session.eventAt(seq));
    if (prior.type === 'turn/start') break;
    const data = object(prior.data);
    if (prior.type === 'tool/call' && data.callId === callId) return typeof data.name === 'string' ? data.name : undefined;
    // TOOL_NOT_STARTED results can precede any tool/call; the model's committed call still names it.
    if (prior.type === 'assistant/message') {
      for (const value of blocks(data.message)) {
        const block = object(value);
        if (block.type === 'tool-call' && block.id === callId && typeof block.name === 'string') return block.name;
      }
    }
  }
}

/** The event listener deliberately does not await this promise; all failures are contained here. */
export async function captureTemp(store: MemoryStore, session: CaptureSession, event: unknown,
  onError: (error: unknown) => void): Promise<void> {
  try {
    const record = toTempRecord(event, resultToolName(session, object(event)));
    if (record) await store.appendTemp(session.id, record);
  } catch (error) { try { onError(error); } catch { /* Recording must never affect DSH. */ } }
}
