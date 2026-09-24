import { finalReply, judgePrompt, parseVerdict, planTurnEnd } from './judge.ts';
import type { Verdict } from './judge.ts';
import { oneShot } from './llm.ts';
import { FAILED_KINDS } from './live-state.ts';
import type { TaskLedger } from './tasks.ts';

export interface JudgeConfig {
  provider: string;
  model: string;
  judgeEnabled: boolean;
  judgeProvider: string;
  judgeModel: string;
  judgeTimeoutMs: number;
  maxContinueRounds: number;
}

interface Dependencies {
  ledger: TaskLedger;
  managed: (session: string) => boolean;
  config: () => JudgeConfig;
  llm: () => unknown;
  messages: (session: string) => unknown;
  title: (session: string) => string | Promise<string>;
  say: (text: string) => Promise<unknown>;
  notify: (text: string) => void;
  onError: (error: unknown) => void;
}

/** Async completion work is tied to both a task id and a per-session turn.
 * The event listener never waits for a model or for the user's answer. */
export class CompletionJudge {
  private readonly deps: Dependencies;
  private readonly versions = new Map<string, number>();
  private readonly jobs = new Map<string, AbortController>();
  private readonly questions = new Map<string, { task: string; version: number }>();
  private disposed = false;

  constructor(deps: Dependencies) { this.deps = deps; }

  turnStarted(session: string): void { this.invalidate(session); }

  invalidate(session: string): void {
    this.versions.set(session, (this.versions.get(session) ?? 0) + 1);
    this.jobs.get(session)?.abort();
    this.jobs.delete(session);
    this.questions.delete(session);
    const task = this.deps.ledger.current(session);
    if (task?.status === 'judging') this.deps.ledger.setStatus(task.id, 'open');
  }

  async turnEnded(session: string, reasonKind?: string): Promise<void> {
    const { ledger } = this.deps;
    if (this.disposed || !this.deps.managed(session)) return;
    const task = ledger.current(session);
    const config = this.deps.config();
    const max = Number.isFinite(config.maxContinueRounds) ? Math.max(0, Math.floor(config.maxContinueRounds)) : 2;
    const action = planTurnEnd({ managed: true, task, reasonKind, max });
    if (action === 'ignore' || !task) return;
    if (action === 'drop') {
      this.invalidate(session);
      ledger.setStatus(task.id, 'dropped');
      return;
    }
    this.jobs.get(session)?.abort();
    const job = new AbortController();
    this.jobs.set(session, job);
    const version = this.versions.get(session) ?? 0;
    const active = (status: string): boolean => {
      const current = ledger.current(session);
      return !this.disposed && !job.signal.aborted && this.deps.managed(session)
        && this.jobs.get(session) === job && (this.versions.get(session) ?? 0) === version
        && current?.id === task.id && current.status === status;
    };
    ledger.setStatus(task.id, action === 'fail' ? 'open' : 'judging');
    try {
      let title = session;
      try { title = (await this.deps.title(session)).trim() || session; } catch { /* A title is optional. */ }
      if (action === 'fail') {
        if (active('open')) await this.deps.say(`${title}失败了：${reasonKind === 'interrupted' ? '被中断' : FAILED_KINDS[reasonKind!]}`);
        return;
      }
      if (!active('judging')) return;
      let reply = '';
      try { reply = finalReply(this.deps.messages(session)); } catch { /* Missing session messages fall back to unclear. */ }
      let verdict: Verdict = { verdict: 'unclear', summary: '做完了' };
      if (config.judgeEnabled && reply) {
        const prompt = judgePrompt(task, reply);
        const raw = await oneShot(this.deps.llm(), {
          ...prompt, provider: config.judgeProvider.trim() || config.provider,
          model: config.judgeModel.trim() || config.model, maxTokens: 300,
          timeoutMs: config.judgeTimeoutMs, purpose: 'jarvis-judge', signal: job.signal,
        });
        verdict = parseVerdict(raw) ?? verdict;
      }
      const result = planTurnEnd({ managed: this.deps.managed(session), task: ledger.current(session),
        reasonKind, verdict, max, stale: !active('judging') });
      if (result === 'ignore') return;
      const recorded = { ...verdict, at: Date.now() };
      if (result === 'continue') {
        ledger.setStatus(task.id, 'unsatisfied', recorded);
        this.questions.set(session, { task: task.id, version });
        try {
          this.deps.notify([
            `[会话 ${title}（id=${session}）本轮结束，判断未满足]`,
            `原始需求：${task.request}`,
            `缺少：${verdict.missing}`,
            `请用 ask_user 问用户是否让它继续（选项：继续 / 不用了），同时传 session=${JSON.stringify(session)}、task=${JSON.stringify(task.id)}。`,
            '用户选继续，就用 inject_to_session 发一条具体的续做指令；选不用了就结束。不要未经用户同意就续做。',
          ].join('\n'));
        } catch (error) {
          this.questions.delete(session);
          ledger.setStatus(task.id, 'open');
          this.deps.onError(error);
        }
      } else {
        // Settle before awaiting speech so its completion cannot overwrite newer work.
        ledger.setStatus(task.id, 'done', recorded);
        const text = result === 'satisfied' ? `${title}：${verdict.summary}`
          : result === 'limit' ? `${title}还没做完：${verdict.missing}，已经续了 ${task.rounds} 次，交给你看看`
          : `${title}做完了`;
        await this.deps.say(text);
      }
    } catch (error) {
      if (active('judging')) ledger.setStatus(task.id, 'open');
      this.deps.onError(error);
    } finally {
      if (this.jobs.get(session) === job) this.jobs.delete(session);
    }
  }

  async askContinuation(session: string, taskId: string, ask: () => Promise<string>): Promise<string> {
    let question = this.questions.get(session);
    const current = this.deps.ledger.current(session);
    // A persisted notice can be answered after reload, before any new activity in this session.
    if (!question && !this.versions.has(session) && current?.id === taskId && current.status === 'unsatisfied') {
      question = { task: taskId, version: 0 };
      this.questions.set(session, question);
    }
    const active = () => !this.disposed && this.deps.managed(session)
      && this.questions.get(session) === question && question?.task === taskId
      && question.version === (this.versions.get(session) ?? 0)
      && this.deps.ledger.current(session)?.id === taskId
      && this.deps.ledger.current(session)?.status === 'unsatisfied';
    if (!active()) throw new Error('续做任务已变化，请不要发送旧的续做指令');
    const answer = await ask();
    if (!active()) return '任务已变化，此回答已失效，请不要发送旧的续做指令';
    if (/^不用了(?:；|$)/.test(answer.trim())) this.deps.ledger.setStatus(taskId, 'dropped');
    if (answer.trim()) this.questions.delete(session);
    return answer;
  }

  dispose(): void {
    this.disposed = true;
    for (const session of this.jobs.keys()) this.invalidate(session);
    this.questions.clear();
    this.versions.clear();
  }
}
