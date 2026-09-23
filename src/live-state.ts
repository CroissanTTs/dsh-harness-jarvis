/**
 * Live session state behind GET /jarvis/state: which sessions are running,
 * how their last turn ended, what is unread, and the approvals / questions
 * held for the悬浮窗. Pure bookkeeping — the DSH wiring lives in index.ts.
 *
 * Held requests race the panel against the rest of the answerer chain (the
 * DSH window), so whichever answers first wins and the other one unmounts.
 *
 * @module dsh-harness-jarvis/live-state
 */
import { randomUUID } from 'node:crypto';

export type Activity = 'idle' | 'awaiting' | 'thinking' | 'speaking';
export type SessionStatus = 'running' | 'waiting' | 'done' | 'failed' | 'idle';
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

export interface QuestionItem {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: { label: string; description?: string }[];
}
export interface QuestionAnswerItem { id: string; selected: string[]; custom?: string }
export interface QuestionAnswer { answers: QuestionAnswerItem[] }

export interface ApprovalRequestLike {
  agent: { id: unknown };
  toolName: string;
  reason?: string;
  signal?: AbortSignal;
}
export interface QuestionRequestLike {
  questions: QuestionItem[];
  agent?: { id: unknown };
  signal?: AbortSignal;
}

/** One card on the panel; a multi-question ask becomes one item per question. */
export interface PendingWire {
  id: string;
  kind: 'approval' | 'question';
  session: string;
  title: string;
  detail?: string;
  note?: string;
  choices: string[];
}

export interface AnswerBody { id?: unknown; decision?: unknown; choice?: unknown; text?: unknown }
export type AnswerResult = 'ok' | 'not-found' | 'invalid';

interface HeldApproval {
  kind: 'approval';
  id: string;
  session: string;
  at: number;
  toolName: string;
  command?: string;
  reason?: string;
  resolve: (outcome: ApprovalOutcome) => void;
}

interface HeldAsk {
  kind: 'ask';
  id: string;
  session: string;
  at: number;
  questions: QuestionItem[];
  answers: Map<string, QuestionAnswerItem>;
  resolve: (answer: QuestionAnswer) => void;
}

type Held = HeldApproval | HeldAsk;

interface LastTurn { at: number; failed: boolean; error?: string }

/** Turn-end kinds that count as a failure (the rest are success or user-initiated stops). */
const FAILED_KINDS: Record<string, string> = {
  error: '模型调用失败',
  blocked: '被拦截',
  'max-tokens': '输出超长被截断',
};

/** Requests settled faster than this (by another answerer) never reach the panel. */
export const PENDING_GRACE_MS = 600;
/** How long "sent, waiting for Jarvis to pick it up" lasts before giving up. */
export const AWAITING_TIMEOUT_MS = 20_000;
const QUESTION_SEP = '#';

export class LiveState {
  private readonly busy = new Set<string>();
  private readonly lastTurns = new Map<string, LastTurn>();
  private readonly unread = new Set<string>();
  private readonly held = new Map<string, Held>();
  private awaitingAt = 0;
  private readonly jarvisId: string;
  private readonly now: () => number;

  constructor(jarvisId: string, now: () => number = Date.now) {
    this.jarvisId = jarvisId;
    this.now = now;
  }

  // ── session events ────────────────────────────────────────────────────

  turnStarted(session: string): void {
    this.busy.add(session);
    this.unread.delete(session);
    this.lastTurns.delete(session);
    if (session === this.jarvisId) this.awaitingAt = 0;
  }

  turnEnded(session: string, reason: { kind?: unknown; error?: any } | undefined): void {
    this.busy.delete(session);
    const kind = typeof reason?.kind === 'string' ? reason.kind : 'completed';
    const label = FAILED_KINDS[kind];
    const turn: LastTurn = { at: this.now(), failed: label !== undefined };
    if (label !== undefined) {
      const detail = typeof reason?.error?.message === 'string' ? reason.error.message.trim() : '';
      turn.error = detail ? `${label}：${detail.slice(0, 80)}` : label;
    }
    this.lastTurns.set(session, turn);
    if (kind === 'completed' && session !== this.jarvisId) this.unread.add(session);
  }

  /** The user typed into the panel; Jarvis has not started its turn yet. */
  userSent(): void { this.awaitingAt = this.now(); }

  /** Clears unread and failed marks for one session, or for all when omitted. */
  markRead(session?: string): void {
    const clear = (id: string) => {
      this.unread.delete(id);
      if (this.lastTurns.get(id)?.failed) this.lastTurns.delete(id);
    };
    if (session) { clear(session); return; }
    for (const id of [...this.unread]) clear(id);
    for (const [id, turn] of [...this.lastTurns]) if (turn.failed) clear(id);
  }

  // ── derived state ─────────────────────────────────────────────────────

  /** `jarvisRunning` is the agent service's status when known; events are the fallback. */
  activity(speaking: boolean, jarvisRunning?: boolean): Activity {
    if (speaking) return 'speaking';
    if (jarvisRunning ?? this.busy.has(this.jarvisId)) return 'thinking';
    if (this.awaitingAt > 0 && this.now() - this.awaitingAt < AWAITING_TIMEOUT_MS) return 'awaiting';
    return 'idle';
  }

  /** Jarvis's own last failure, cleared when its next turn starts or on read. */
  error(): string | null {
    const turn = this.lastTurns.get(this.jarvisId);
    return turn?.failed ? (turn.error ?? '上一轮失败') : null;
  }

  isUnread(session: string): boolean { return this.unread.has(session); }

  status(session: string, running?: boolean): SessionStatus {
    if (this.visibleHeld().some((h) => h.session === session)) return 'waiting';
    if (running ?? this.busy.has(session)) return 'running';
    if (this.lastTurns.get(session)?.failed) return 'failed';
    if (this.unread.has(session)) return 'done';
    return 'idle';
  }

  pending(): PendingWire[] {
    const items: PendingWire[] = [];
    for (const h of this.visibleHeld()) {
      if (h.kind === 'approval') {
        items.push({
          id: h.id, kind: 'approval', session: h.session, title: h.toolName,
          detail: h.command ?? h.toolName,
          ...(h.reason ? { note: h.reason } : {}),
          choices: [],
        });
        continue;
      }
      for (const q of h.questions) {
        if (h.answers.has(q.id)) continue;
        items.push({
          id: h.id + QUESTION_SEP + q.id, kind: 'question', session: h.session, title: q.question,
          ...(q.detail ? { detail: q.detail } : {}),
          ...(q.header ? { note: q.header } : {}),
          choices: (q.options ?? []).map((o) => o.label).filter((l) => typeof l === 'string' && l.length > 0),
        });
      }
    }
    return items;
  }

  // ── held requests ─────────────────────────────────────────────────────

  holdApproval(req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>, command?: string): Promise<ApprovalOutcome> {
    const id = randomUUID();
    const original = req.signal;
    const downstream = new AbortController();
    const restore = swapSignal(req, downstream.signal);
    const fromPanel = new Promise<ApprovalOutcome>((resolve) => {
      this.held.set(id, {
        kind: 'approval', id, session: String(req.agent.id), at: this.now(), toolName: req.toolName,
        ...(command ? { command } : {}),
        ...(req.reason ? { reason: req.reason } : {}),
        resolve,
      });
      original?.addEventListener('abort', () => { this.held.delete(id); }, { once: true });
    });
    return Promise.race([fromPanel, Promise.resolve().then(next)]).finally(() => {
      downstream.abort(new Error('Approval settled through another answerer'));
      restore();
      this.held.delete(id);
    });
  }

  holdAsk(req: QuestionRequestLike, next: () => Promise<QuestionAnswer>): Promise<QuestionAnswer> {
    const session = req.agent ? String(req.agent.id) : '';
    if (!session || !Array.isArray(req.questions) || req.questions.length === 0) return next();
    const id = randomUUID();
    const original = req.signal;
    const downstream = new AbortController();
    const restore = swapSignal(req, downstream.signal);
    const fromPanel = new Promise<QuestionAnswer>((resolve) => {
      this.held.set(id, {
        kind: 'ask', id, session, at: this.now(), questions: req.questions, answers: new Map(), resolve,
      });
      original?.addEventListener('abort', () => { this.held.delete(id); }, { once: true });
    });
    return Promise.race([fromPanel, Promise.resolve().then(next)]).finally(() => {
      // Cancel only the losing answerer's wait, never the owning agent's signal.
      downstream.abort(new Error('Question settled through another answerer'));
      restore();
      this.held.delete(id);
    });
  }

  /** POST /jarvis/pending/answer. */
  answer(body: AnswerBody): AnswerResult {
    const rawId = typeof body.id === 'string' ? body.id : '';
    if (!rawId) return 'invalid';
    const sep = rawId.indexOf(QUESTION_SEP);
    const heldId = sep < 0 ? rawId : rawId.slice(0, sep);
    const held = this.held.get(heldId);
    if (!held) return 'not-found';

    if (held.kind === 'approval') {
      if (sep >= 0) return 'not-found';
      if (body.decision !== 'allow' && body.decision !== 'deny') return 'invalid';
      this.held.delete(heldId);
      held.resolve(body.decision === 'allow' ? 'allowed-once' : 'rejected');
      return 'ok';
    }

    const questionId = sep < 0 ? '' : rawId.slice(sep + 1);
    const question = held.questions.find((q) => q.id === questionId);
    if (!question || held.answers.has(question.id)) return 'not-found';
    let item: QuestionAnswerItem;
    if (typeof body.choice === 'string' && body.choice.length > 0) {
      item = { id: question.id, selected: [body.choice] };
    } else if (typeof body.text === 'string' && body.text.trim().length > 0) {
      item = { id: question.id, selected: [], custom: body.text.trim() };
    } else {
      return 'invalid';
    }
    held.answers.set(question.id, item);
    if (held.answers.size === held.questions.length) {
      this.held.delete(heldId);
      held.resolve({ answers: held.questions.map((q) => held.answers.get(q.id)!) });
    }
    return 'ok';
  }

  private visibleHeld(): Held[] {
    const cutoff = this.now() - PENDING_GRACE_MS;
    return [...this.held.values()].filter((h) => h.at <= cutoff).sort((a, b) => a.at - b.at);
  }
}

/** Points the downstream answerers at a signal we can abort, and returns the undo. */
function swapSignal(req: { signal?: AbortSignal }, downstream: AbortSignal): () => void {
  const original = req.signal;
  try {
    (req as { signal?: AbortSignal }).signal = original ? AbortSignal.any([original, downstream]) : downstream;
  } catch {
    return () => {};
  }
  return () => {
    try {
      if (original === undefined) delete (req as { signal?: AbortSignal }).signal;
      else (req as { signal?: AbortSignal }).signal = original;
    } catch {}
  };
}
