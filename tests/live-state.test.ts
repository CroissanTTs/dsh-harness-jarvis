import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AWAITING_TIMEOUT_MS, LiveState, MAX_WAIT_MS, PENDING_GRACE_MS, SPEECH_STALE_MS,
  type ApprovalOutcome, type QuestionAnswer,
} from '../src/live-state.ts';

const JARVIS = 'jarvis';

function setup() {
  let t = 1_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  return { live: new LiveState(JARVIS, clock.now), clock };
}

/** A downstream answerer that never answers on its own (a human looking away). */
function waitingNext<T>(): { next: () => Promise<T>; settle: (v: T) => void; calls: () => number } {
  let settle!: (v: T) => void;
  let calls = 0;
  const p = new Promise<T>((r) => { settle = r; });
  return { next: () => { calls += 1; return p; }, settle: (v) => settle(v), calls: () => calls };
}

const tick = () => new Promise((r) => setImmediate(r));

// ── 等价类 ──────────────────────────────────────────────────────────────
describe('等价类', () => {
  it('Jarvis 活动：说话 > 思考 > 等待回复 > 空闲', () => {
    const { live } = setup();
    assert.equal(live.activity(false), 'idle');
    live.userSent();
    assert.equal(live.activity(false), 'awaiting');
    live.turnStarted(JARVIS);
    assert.equal(live.activity(false), 'thinking');
    assert.equal(live.activity(true), 'speaking');
    live.turnEnded(JARVIS, { kind: 'completed' });
    assert.equal(live.activity(false), 'idle');
  });

  it('agent 服务的状态优先于事件推断', () => {
    const { live } = setup();
    live.turnStarted(JARVIS);
    assert.equal(live.activity(false, false), 'idle');
    live.turnEnded(JARVIS, { kind: 'completed' });
    assert.equal(live.activity(false, true), 'thinking');
  });

  it('会话状态：运行中 / 完成未读 / 失败 / 空闲', () => {
    const { live } = setup();
    live.turnStarted('a');
    assert.equal(live.status('a'), 'running');
    live.turnEnded('a', { kind: 'completed' });
    assert.equal(live.status('a'), 'done');
    assert.equal(live.isUnread('a'), true);
    live.turnStarted('b');
    live.turnEnded('b', { kind: 'error', error: { message: 'rate limited' } });
    assert.equal(live.status('b'), 'failed');
    assert.equal(live.status('c'), 'idle');
  });

  it('用户主动中断不算失败也不算未读', () => {
    const { live } = setup();
    live.turnStarted('a');
    live.turnEnded('a', { kind: 'aborted' });
    assert.equal(live.status('a'), 'idle');
    live.turnStarted('a');
    live.turnEnded('a', { kind: 'interrupted' });
    assert.equal(live.status('a'), 'idle');
  });

  it('Jarvis 自己完成回合不计未读，失败时给出错误文案', () => {
    const { live } = setup();
    live.turnEnded(JARVIS, { kind: 'completed' });
    assert.equal(live.isUnread(JARVIS), false);
    assert.equal(live.error(), null);
    live.turnEnded(JARVIS, { kind: 'max-tokens' });
    assert.equal(live.error(), '输出超长被截断');
    live.turnStarted(JARVIS);
    assert.equal(live.error(), null);
  });

  it('批准 / 拒绝映射为 DSH 的审批结果', async () => {
    for (const [decision, expected] of [['allow', 'allowed-once'], ['deny', 'rejected']] as const) {
      const { live, clock } = setup();
      const down = waitingNext<ApprovalOutcome>();
      const result = live.holdApproval({ agent: { id: 'a' }, toolName: 'bash' }, down.next, 'rm -rf build');
      clock.advance(PENDING_GRACE_MS);
      const [item] = live.pending();
      assert.equal(item?.kind, 'approval');
      assert.equal(item?.detail, 'rm -rf build');
      assert.equal(live.status('a'), 'waiting');
      assert.equal(live.answer({ id: item!.id, decision }), 'ok');
      assert.equal(await result, expected);
      assert.deepEqual(live.pending(), []);
    }
  });

  it('多问题拆成多张卡片，全部答完才回传', async () => {
    const { live, clock } = setup();
    const down = waitingNext<QuestionAnswer>();
    let settled: QuestionAnswer | undefined;
    void live.holdAsk({
      agent: { id: 'a' },
      questions: [
        { id: 'q1', question: '用哪个方案？', options: [{ label: 'A' }, { label: 'B' }] },
        { id: 'q2', question: '补充说明', header: '可选' },
      ],
    }, down.next).then((a) => { settled = a; });
    clock.advance(PENDING_GRACE_MS);
    const cards = live.pending();
    assert.equal(cards.length, 2);
    assert.deepEqual(cards[0]?.choices, ['A', 'B']);
    assert.equal(cards[1]?.note, '可选');

    assert.equal(live.answer({ id: cards[0]!.id, choice: 'B' }), 'ok');
    await tick();
    assert.equal(settled, undefined);
    assert.equal(live.pending().length, 1);

    assert.equal(live.answer({ id: cards[1]!.id, text: '  尽快  ' }), 'ok');
    await tick();
    assert.deepEqual(settled, { answers: [
      { id: 'q1', selected: ['B'] },
      { id: 'q2', selected: [], custom: '尽快' },
    ] });
  });

  it('DSH 窗口先答了，面板上的卡片随之消失', async () => {
    const { live, clock } = setup();
    const down = waitingNext<ApprovalOutcome>();
    const result = live.holdApproval({ agent: { id: 'a' }, toolName: 'bash' }, down.next);
    clock.advance(PENDING_GRACE_MS);
    assert.equal(live.pending().length, 1);
    down.settle('rejected');
    assert.equal(await result, 'rejected');
    assert.deepEqual(live.pending(), []);
  });

  it('面板先答时撤掉下游答复者的等待', async () => {
    const { live, clock } = setup();
    const req: { agent: { id: string }; toolName: string; signal?: AbortSignal } = { agent: { id: 'a' }, toolName: 'bash' };
    let downstream: AbortSignal | undefined;
    const result = live.holdApproval(req, () => { downstream = req.signal; return new Promise(() => {}); });
    await tick();
    clock.advance(PENDING_GRACE_MS);
    live.answer({ id: live.pending()[0]!.id, decision: 'allow' });
    assert.equal(await result, 'allowed-once');
    assert.equal(downstream?.aborted, true);
    assert.equal(req.signal, undefined);
  });

  it('说话来源：贾维斯 / 其他会话，结束信号清掉', () => {
    const { live } = setup();
    assert.equal(live.speech(), null);
    live.speechSignal({ phase: 'start', id: 's1', source: 'jarvis' });
    assert.deepEqual(live.speech(), { source: 'jarvis' });
    live.speechSignal({ phase: 'end', id: 's1', source: 'jarvis' });
    assert.equal(live.speech(), null);
    live.speechSignal({ phase: 'start', id: 's2', source: 'session', sessionId: 'worker' });
    assert.deepEqual(live.speech(), { source: 'session', sessionId: 'worker' });
  });

  it('说话、回合、待处理的变化都会唤醒等待者', async () => {
    const { live, clock } = setup();
    const changes: Array<() => void> = [
      () => live.speechSignal({ phase: 'start', id: 's', source: 'jarvis' }),
      () => live.turnStarted('a'),
      () => live.turnEnded('a', { kind: 'completed' }),
      () => live.userSent(),
      () => live.markRead('a'),
    ];
    for (const change of changes) {
      const before = live.version;
      const woke = live.waitForChange(before, 10_000);
      change();
      assert.equal(await woke, before + 1);
    }
    const down = waitingNext<ApprovalOutcome>();
    void live.holdApproval({ agent: { id: 'a' }, toolName: 'bash' }, down.next);
    clock.advance(PENDING_GRACE_MS);
    const before = live.version;
    const woke = live.waitForChange(before, 10_000);
    live.answer({ id: live.pending()[0]!.id, decision: 'allow' });
    assert.ok(await woke > before);
  });

  it('已读：单个会话 / 全部', () => {
    const { live } = setup();
    for (const id of ['a', 'b']) { live.turnStarted(id); live.turnEnded(id, { kind: 'completed' }); }
    live.turnStarted('c');
    live.turnEnded('c', { kind: 'blocked' });
    live.markRead('a');
    assert.equal(live.status('a'), 'idle');
    assert.equal(live.status('b'), 'done');
    live.markRead();
    assert.equal(live.status('b'), 'idle');
    assert.equal(live.status('c'), 'idle');
  });
});

// ── 边界值 ──────────────────────────────────────────────────────────────
describe('边界值', () => {
  it('等待回复在超时前一刻仍显示，到点后回到空闲', () => {
    const { live, clock } = setup();
    live.userSent();
    clock.advance(AWAITING_TIMEOUT_MS - 1);
    assert.equal(live.activity(false), 'awaiting');
    clock.advance(1);
    assert.equal(live.activity(false), 'idle');
  });

  it('审批在宽限期内不上面板，刚好满宽限期出现', () => {
    const { live, clock } = setup();
    void live.holdApproval({ agent: { id: 'a' }, toolName: 'bash' }, waitingNext<ApprovalOutcome>().next);
    clock.advance(PENDING_GRACE_MS - 1);
    assert.deepEqual(live.pending(), []);
    assert.equal(live.status('a'), 'idle');
    clock.advance(1);
    assert.equal(live.pending().length, 1);
  });

  it('多个待处理按提出时间排序', () => {
    const { live, clock } = setup();
    void live.holdApproval({ agent: { id: 'first' }, toolName: 'bash' }, waitingNext<ApprovalOutcome>().next);
    clock.advance(10);
    void live.holdApproval({ agent: { id: 'second' }, toolName: 'edit' }, waitingNext<ApprovalOutcome>().next);
    clock.advance(PENDING_GRACE_MS);
    assert.deepEqual(live.pending().map((p) => p.session), ['first', 'second']);
  });

  it('没有命令详情时退回显示工具名；空选项标签被丢弃', () => {
    const { live, clock } = setup();
    void live.holdApproval({ agent: { id: 'a' }, toolName: 'write_file' }, waitingNext<ApprovalOutcome>().next);
    void live.holdAsk({ agent: { id: 'a' }, questions: [{ id: 'q', question: '?', options: [{ label: '' }, { label: '好' }] }] },
      waitingNext<QuestionAnswer>().next);
    clock.advance(PENDING_GRACE_MS);
    const [approval, question] = live.pending();
    assert.equal(approval?.detail, 'write_file');
    assert.equal(approval?.note, undefined);
    assert.deepEqual(question?.choices, ['好']);
  });

  it('错误文案截断到 80 字', () => {
    const { live } = setup();
    live.turnEnded(JARVIS, { kind: 'error', error: { message: 'x'.repeat(200) } });
    assert.equal(live.error(), '模型调用失败：' + 'x'.repeat(80));
  });

  it('turn/end 缺少 reason 视为正常完成', () => {
    const { live } = setup();
    live.turnStarted('a');
    live.turnEnded('a', undefined);
    assert.equal(live.status('a'), 'done');
  });

  it('开始信号没等到结束：到过期前一刻仍在说，到点后视为结束', () => {
    const { live, clock } = setup();
    live.speechSignal({ phase: 'start', id: 's', source: 'session', sessionId: 'w' });
    clock.advance(SPEECH_STALE_MS - 1);
    assert.notEqual(live.speech(), null);
    clock.advance(1);
    assert.equal(live.speech(), null);
  });

  it('新一句的开始直接接替上一句，旧句的结束信号不影响新句', () => {
    const { live } = setup();
    live.speechSignal({ phase: 'start', id: 'old', source: 'jarvis' });
    live.speechSignal({ phase: 'start', id: 'new', source: 'session', sessionId: 'w' });
    live.speechSignal({ phase: 'end', id: 'old', source: 'jarvis' });
    assert.deepEqual(live.speech(), { source: 'session', sessionId: 'w' });
  });

  it('等待：版本已变立即返回；没变化到超时返回原版本', async () => {
    const { live } = setup();
    live.turnStarted('a');
    assert.equal(await live.waitForChange(0, 10_000), live.version);
    const started = Date.now();
    assert.equal(await live.waitForChange(live.version, 30), live.version);
    assert.ok(Date.now() - started >= 25);
  });

  it('待处理卡片满宽限期时再唤醒一次，让面板及时显示', async () => {
    const { live } = setup();
    void live.holdApproval({ agent: { id: 'a' }, toolName: 'bash' }, waitingNext<ApprovalOutcome>().next);
    const before = live.version;
    const started = Date.now();
    assert.equal(await live.waitForChange(before, 5_000), before + 1);
    assert.ok(Date.now() - started >= PENDING_GRACE_MS - 20);
  });

  it('新回合开始清掉上一轮的未读和失败', () => {
    const { live } = setup();
    live.turnEnded('a', { kind: 'error' });
    live.turnStarted('a');
    assert.equal(live.status('a'), 'running');
    live.turnEnded('a', { kind: 'completed' });
    live.turnStarted('a');
    assert.equal(live.isUnread('a'), false);
  });
});

// ── 异常路径 ────────────────────────────────────────────────────────────
describe('异常路径', () => {
  it('回答不存在或已结束的请求返回 not-found', async () => {
    const { live, clock } = setup();
    assert.equal(live.answer({ id: 'nope', decision: 'allow' }), 'not-found');
    const down = waitingNext<ApprovalOutcome>();
    const result = live.holdApproval({ agent: { id: 'a' }, toolName: 'bash' }, down.next);
    clock.advance(PENDING_GRACE_MS);
    const id = live.pending()[0]!.id;
    down.settle('rejected');
    await result;
    assert.equal(live.answer({ id, decision: 'allow' }), 'not-found');
  });

  it('请求体不合法返回 invalid，且不结束请求', () => {
    const { live, clock } = setup();
    void live.holdApproval({ agent: { id: 'a' }, toolName: 'bash' }, waitingNext<ApprovalOutcome>().next);
    void live.holdAsk({ agent: { id: 'a' }, questions: [{ id: 'q', question: '?' }] }, waitingNext<QuestionAnswer>().next);
    clock.advance(PENDING_GRACE_MS);
    const [approval, question] = live.pending();
    assert.equal(live.answer({}), 'invalid');
    assert.equal(live.answer({ id: 42 }), 'invalid');
    assert.equal(live.answer({ id: approval!.id, decision: 'maybe' }), 'invalid');
    assert.equal(live.answer({ id: question!.id }), 'invalid');
    assert.equal(live.answer({ id: question!.id, text: '   ' }), 'invalid');
    assert.equal(live.pending().length, 2);
  });

  it('问题编号对不上 / 重复回答同一题返回 not-found', () => {
    const { live, clock } = setup();
    void live.holdAsk({ agent: { id: 'a' }, questions: [{ id: 'q1', question: '1' }, { id: 'q2', question: '2' }] },
      waitingNext<QuestionAnswer>().next);
    clock.advance(PENDING_GRACE_MS);
    const [first] = live.pending();
    const heldId = first!.id.split('#')[0]!;
    assert.equal(live.answer({ id: heldId + '#zzz', choice: 'x' }), 'not-found');
    assert.equal(live.answer({ id: heldId, choice: 'x' }), 'not-found');
    assert.equal(live.answer({ id: first!.id, choice: 'x' }), 'ok');
    assert.equal(live.answer({ id: first!.id, choice: 'y' }), 'not-found');
  });

  it('给审批加问题后缀视为不存在', () => {
    const { live, clock } = setup();
    void live.holdApproval({ agent: { id: 'a' }, toolName: 'bash' }, waitingNext<ApprovalOutcome>().next);
    clock.advance(PENDING_GRACE_MS);
    assert.equal(live.answer({ id: live.pending()[0]!.id + '#q', decision: 'allow' }), 'not-found');
  });

  it('请求被取消时卡片立即消失', async () => {
    const { live, clock } = setup();
    const abort = new AbortController();
    void live.holdApproval({ agent: { id: 'a' }, toolName: 'bash', signal: abort.signal },
      waitingNext<ApprovalOutcome>().next);
    clock.advance(PENDING_GRACE_MS);
    assert.equal(live.pending().length, 1);
    abort.abort();
    assert.deepEqual(live.pending(), []);
  });

  it('没有归属会话或没有问题的提问直接交给下游', async () => {
    const { live } = setup();
    const answer: QuestionAnswer = { answers: [] };
    assert.equal(await live.holdAsk({ questions: [{ id: 'q', question: '?' }] }, async () => answer), answer);
    assert.equal(await live.holdAsk({ agent: { id: 'a' }, questions: [] }, async () => answer), answer);
  });

  it('下游答复者抛错时向上传递，并清理卡片', async () => {
    const { live, clock } = setup();
    const result = live.holdApproval({ agent: { id: 'a' }, toolName: 'bash' }, async () => { throw new Error('boom'); });
    clock.advance(PENDING_GRACE_MS);
    await assert.rejects(result, /boom/);
    assert.deepEqual(live.pending(), []);
  });

  it('不合法的说话信号被忽略', () => {
    const { live } = setup();
    for (const bad of [null, undefined, 'start', {}, { phase: 'start' }, { phase: 'start', id: '' }, { phase: 'talk', id: 'x' }]) {
      live.speechSignal(bad);
    }
    assert.equal(live.speech(), null);
    assert.equal(live.version, 0);
  });

  it('来源未知按贾维斯处理；结束一句从未开始的话不改变状态', () => {
    const { live } = setup();
    live.speechSignal({ phase: 'end', id: 'ghost', source: 'jarvis' });
    assert.equal(live.version, 0);
    live.speechSignal({ phase: 'start', id: 's', source: 'robot', sessionId: 42 });
    assert.deepEqual(live.speech(), { source: 'jarvis' });
  });

  it('等待超时被限制在上限内', async () => {
    const { live } = setup();
    const started = Date.now();
    await live.waitForChange(live.version, -5);
    assert.ok(Date.now() - started < 100);
    assert.ok(MAX_WAIT_MS <= 25_000);
  });

  it('信号不可写时仍能正常托管', async () => {
    const { live, clock } = setup();
    const req = Object.freeze({ agent: { id: 'a' }, toolName: 'bash' });
    const result = live.holdApproval(req, waitingNext<ApprovalOutcome>().next);
    clock.advance(PENDING_GRACE_MS);
    live.answer({ id: live.pending()[0]!.id, decision: 'deny' });
    assert.equal(await result, 'rejected');
  });
});
