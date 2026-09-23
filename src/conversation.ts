/** Turns a DSH session's derived messages into the panel's chat list. No DSH imports. */

export interface ChatLine {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  routedTo?: string;
  toolCalls?: { name: string; args: string }[];
}

/** How /jarvis/input wraps text the user asked Jarvis to relay to a session. */
export const routedInput = (session: string, text: string): string =>
  `用户要求把以下内容发给会话 ${session}。请优化说法后用 inject_to_session 发送：\n\n${text}`;
const ROUTED_INPUT = /^用户要求把以下内容发给会话 (\S+)。请优化说法后用 inject_to_session 发送：\n\n([\s\S]*)$/;

export const CONVERSATION_LIMIT = 20;

/** User/assistant messages with text or tool calls, newest last, capped at `limit`. */
export function toConversation(messages: readonly unknown[], limit = CONVERSATION_LIMIT): ChatLine[] {
  const out: ChatLine[] = [];
  messages.forEach((raw, index) => {
    const m = raw as { id?: unknown; role?: unknown; content?: unknown } | null;
    const role = m?.role;
    if (role !== 'user' && role !== 'assistant') return;
    const texts: string[] = [];
    const toolCalls: { name: string; args: string }[] = [];
    let routedTo: string | undefined;
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      if (b?.type === 'toolCall' || b?.type === 'tool_call') {
        const rawArgs = b.arguments ?? b.input;
        let args: any = rawArgs;
        if (typeof rawArgs === 'string') { try { args = JSON.parse(rawArgs); } catch { args = undefined; } }
        if (b.name === 'inject_to_session' && typeof args?.session === 'string') routedTo = args.session;
        toolCalls.push({
          name: String(b.name ?? '?'),
          args: (typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? '')).slice(0, 200),
        });
      }
    }
    let text = texts.join('');
    const routed = role === 'user' ? ROUTED_INPUT.exec(text) : null;
    if (routed) { routedTo = routed[1]; text = routed[2] ?? ''; }
    if (!text && toolCalls.length === 0) return;
    out.push({
      id: String(m?.id ?? `m${index}`),
      role, text,
      ...(routedTo ? { routedTo } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
  });
  return limit > 0 ? out.slice(-limit) : [];
}
