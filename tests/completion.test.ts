import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskLedger } from '../src/tasks.ts';
import { CompletionJudge, type JudgeConfig } from '../src/completion.ts';

let dir: string;
let ledger: TaskLedger;
let judge: CompletionJudge;
let managed: Set<string>;
let spoken: string[];
let notices: string[];
let errors: unknown[];
let messages: unknown;
let llm: any;
let calls: any[];
let config: JudgeConfig;
let getTitle: () => string | Promise<string>;
let say: (text: string) => Promise<unknown>;
let notify: (text: string) => void;
const stream = (verdict = 'satisfied', summary = '已完成', missing = '补测试') => ({
  async *stream(options: unknown) {
    calls.push(options);
    yield { type: 'text-delta', text: JSON.stringify({ verdict, summary, missing }) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const saved = (): any[] => JSON.parse(readFileSync(join(dir, 'tasks.json'), 'utf8'));
const createJudge = () => new CompletionJudge({
  ledger, managed: (id: string) => managed.has(id), config: () => config, llm: () => llm,
  messages: () => messages, title: () => getTitle(), say: (text: string) => say(text),
  notify: (text: string) => notify(text), onError: (error: unknown) => errors.push(error),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jv-completion-'));
  ledger = new TaskLedger(join(dir, 'tasks.json'));
  managed = new Set(['a', 'b']); spoken = []; notices = []; errors = []; calls = [];
  messages = [{ role: 'user', content: [{ type: 'text', text: '需求' }] }, { role: 'assistant', content: [{ type: 'text', text: '结果' }] }];
  llm = stream();
  config = { provider: 'base-provider', model: 'base-model', judgeEnabled: true, judgeProvider: '', judgeModel: '', judgeTimeoutMs: 100, maxContinueRounds: 2 };
  getTitle = () => 'hammer';
  say = async text => { spoken.push(text); };
  notify = text => { notices.push(text); };
  judge = createJudge();
});
afterEach(() => { judge.dispose(); rmSync(dir, { recursive: true, force: true }); });

describe('等价类', () => {
  it('满足后保存裁决并直接播报，不唤醒贾维斯', async () => {
    ledger.open('a', '需求');
    await judge.turnEnded('a', 'completed');
    assert.deepEqual(spoken, ['hammer：已完成']);
    assert.equal(notices.length, 0);
    assert.equal(saved()[0].status, 'done');
    assert.equal(saved()[0].lastVerdict.verdict, 'satisfied');
    assert.equal(calls[0].provider, 'base-provider');
    assert.equal(calls[0].maxTokens, 300);
  });

  it('未满足时通知贾维斯询问，用户继续后复用任务和原需求', async () => {
    llm = stream('unsatisfied');
    ledger.expect('a', '用户原话');
    const task = ledger.open('a', '改写指令');
    await judge.turnEnded('a', 'completed');
    assert.equal(ledger.current('a')?.status, 'unsatisfied');
    assert.equal(spoken.length, 0);
    assert.match(notices[0], /判断未满足/);
    assert.ok(notices[0].includes(task.id));
    assert.ok(notices[0].includes('用户原话'));
    assert.equal(await judge.askContinuation('a', task.id, async () => '继续'), '继续');
    const next = ledger.open('a', '补测试');
    assert.equal(next.id, task.id);
    assert.equal(next.rounds, 1);
    assert.equal(next.request, '用户原话');
    assert.equal(next.status, 'open');
  });

  it('用户选不用了后关闭任务，后续直接聊天不触发判断', async () => {
    llm = stream('unsatisfied');
    const task = ledger.open('a', '需求');
    await judge.turnEnded('a', 'completed');
    await judge.askContinuation('a', task.id, async () => '不用了');
    assert.equal(saved()[0].status, 'dropped');
    judge.turnStarted('a');
    await judge.turnEnded('a', 'completed');
    assert.equal(calls.length, 1);
  });

  for (const [kind, reason] of [['error', '模型调用失败'], ['blocked', '被拦截'], ['max-tokens', '输出超长被截断'], ['interrupted', '被中断']]) {
    it(`${kind} 只播失败原因，任务保持 open`, async () => {
      ledger.open('a', '需求');
      await judge.turnEnded('a', kind);
      assert.deepEqual(spoken, [`hammer失败了：${reason}`]);
      assert.equal(ledger.current('a')?.status, 'open');
      assert.equal(calls.length, 0);
    });
  }
});

describe('边界值', () => {
  it('达到续轮上限后播报缺项并结束，max=0 也不提问', async () => {
    llm = stream('unsatisfied');
    const task = ledger.open('a', '需求');
    ledger.bumpRound(task.id); ledger.bumpRound(task.id);
    await judge.turnEnded('a', 'completed');
    assert.deepEqual(spoken, ['hammer还没做完：补测试，已经续了 2 次，交给你看看']);
    assert.equal(notices.length, 0);
    assert.equal(saved()[0].status, 'done');
    config.maxContinueRounds = 0;
    ledger.open('b', '需求');
    await judge.turnEnded('b', 'completed');
    assert.match(spoken[1], /已经续了 0 次/);
  });

  it('开关关闭、空回复、缺少模型均走完成模板', async () => {
    for (const condition of ['disabled', 'empty', 'no-llm']) {
      ledger.open('a', '需求');
      config.judgeEnabled = condition !== 'disabled';
      messages = condition === 'empty' ? [] : [{ role: 'assistant', content: [{ type: 'text', text: '结果' }] }];
      llm = condition === 'no-llm' ? undefined : stream();
      await judge.turnEnded('a', 'completed');
      assert.equal(saved().at(-1).lastVerdict.verdict, 'unclear');
    }
    assert.deepEqual(spoken, Array(3).fill('hammer做完了'));
    assert.equal(calls.length, 0);
  });

  it('专用 provider/model 覆盖默认且其他会话开始不影响判断', async () => {
    config.judgeProvider = 'judge-provider'; config.judgeModel = 'judge-model';
    ledger.open('a', '需求');
    const title = deferred<string>(); getTitle = () => title.promise;
    const pending = judge.turnEnded('a', 'completed');
    judge.turnStarted('b'); title.resolve('hammer');
    await pending;
    assert.equal(calls[0].provider, 'judge-provider');
    assert.equal(calls[0].model, 'judge-model');
    assert.equal(spoken.length, 1);
  });

  it('相同 completed 重复事件只调用一次模型和播报', async () => {
    ledger.open('a', '需求');
    const pending = judge.turnEnded('a', 'completed');
    await judge.turnEnded('a', 'completed');
    await pending;
    assert.equal(calls.length, 1);
    assert.equal(spoken.length, 1);
  });

  it('插件重启后仍可回答持久化的未满足任务，拒绝可附带说明', async () => {
    llm = stream('unsatisfied');
    const task = ledger.open('a', '需求');
    await judge.turnEnded('a', 'completed');
    judge.dispose();
    judge = createJudge();
    await judge.askContinuation('a', task.id, async () => '不用了；我来处理');
    assert.equal(saved()[0].status, 'dropped');
  });
});

describe('异常路径', () => {
  it('未托管、无任务、未知原因都不判断或播报，aborted 静默丢弃', async () => {
    ledger.open('outside', '需求');
    await judge.turnEnded('outside', 'completed');
    await judge.turnEnded('a', 'completed');
    ledger.open('a', '需求');
    await judge.turnEnded('a', 'unknown');
    await judge.turnEnded('a', 'aborted');
    assert.equal(ledger.current('a'), undefined);
    assert.equal(spoken.length + notices.length + calls.length, 0);
  });

  for (const change of ['start', 'replace', 'release', 'dispose']) {
    it(`等待模型期间 ${change} 会丢弃旧结果`, async () => {
      const gate = deferred<void>();
      let started = deferred<void>();
      llm = { async *stream() {
        started.resolve(); await gate.promise;
        yield { type: 'text-delta', text: '{"verdict":"satisfied","summary":"旧结果"}' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } };
      const old = ledger.open('a', '旧需求');
      const pending = judge.turnEnded('a', 'completed');
      await started.promise;
      if (change === 'start') judge.turnStarted('a');
      if (change === 'replace') ledger.open('a', '新需求');
      if (change === 'release') { managed.delete('a'); ledger.dropSession('a'); judge.invalidate('a'); }
      if (change === 'dispose') judge.dispose();
      gate.resolve(); await pending;
      assert.equal(spoken.length + notices.length, 0);
      assert.notEqual(saved().find(t => t.id === old.id).status, 'done');
      if (change === 'start') assert.equal(ledger.current('a')?.status, 'open');
    });
  }

  it('用户答复前任务被替换，旧回答不能结束新任务或作为续做答复', async () => {
    llm = stream('unsatisfied');
    const old = ledger.open('a', '旧需求');
    await judge.turnEnded('a', 'completed');
    const answer = deferred<string>();
    const pending = judge.askContinuation('a', old.id, () => answer.promise);
    ledger.expect('a', '新需求');
    const fresh = ledger.open('a', '新指令');
    answer.resolve('不用了');
    assert.match(await pending, /已变化/);
    assert.equal(ledger.current('a')?.id, fresh.id);
    assert.equal(ledger.current('a')?.status, 'open');
    await assert.rejects(judge.askContinuation('a', old.id, async () => '继续'));
  });

  it('无效模型输出和超时降级模板，标题不可用回退 id', async () => {
    llm = { async *stream() { yield { type: 'text-delta', text: 'not JSON' }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
    getTitle = () => { throw new Error('title unavailable'); };
    ledger.open('a', '需求');
    await judge.turnEnded('a', 'completed');
    assert.deepEqual(spoken, ['a做完了']);
    config.judgeTimeoutMs = 5;
    llm = { async *stream() { await new Promise(() => {}); } };
    ledger.open('b', '需求');
    await judge.turnEnded('b', 'completed');
    assert.equal(spoken[1], 'b做完了');
  });

  it('通知失败恢复 open，播报失败不影响之后新任务', async () => {
    llm = stream('unsatisfied');
    notify = () => { throw new Error('Jarvis unavailable'); };
    ledger.open('a', '需求');
    await judge.turnEnded('a', 'completed');
    assert.equal(ledger.current('a')?.status, 'open');
    llm = stream(); say = async () => { throw new Error('speech failed'); };
    await judge.turnEnded('a', 'completed');
    assert.equal(saved()[0].status, 'done');
    assert.equal(errors.length, 2);
  });
});
