import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OutputCoordinator } from '../src/output.ts';

function setup() {
  let now = 0;
  let serial = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const said: string[] = [];
  const managed = new Set(['a', 'b']);
  const output = new OutputCoordinator({
    say: async text => { said.push(text); }, managed: id => managed.has(id),
    clock: {
      setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: id => { timers.delete(id as number); },
    },
  });
  function tick(ms: number) {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    now = end;
  }
  return { output, tick, said, managed, timers };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

describe('等价类', () => {
  it('窗口内两个会话合并，单条保留原文', async () => {
    const { output, tick, said } = setup();
    const a = output.announce('a', 'hammer：测试通过', { title: 'hammer' });
    const b = output.announce('b', 'anvil做完了', { title: 'anvil' });
    assert.deepEqual(said, []);
    tick(1500);
    await Promise.all([a, b]);
    assert.deepEqual(said, ['hammer 和 anvil 都做完了']);
    const single = output.announce('a', '原文');
    tick(1500);
    await single;
    assert.equal(said[1], '原文');
  });
  it('三个会话合并为前两个名称和总数', async () => {
    const { output, tick, said } = setup();
    const all = ['hammer', 'anvil', 'forge'].map(id => output.announce(id, '完成'));
    tick(1500);
    await Promise.all(all);
    assert.deepEqual(said, ['hammer、anvil 等 3 个会话做完了']);
  });
  it('失败与未完成提醒立即播报，不加入完成合并', async () => {
    const { output, tick, said } = setup();
    const pending = output.announce('a', 'a完成');
    await output.announce('b', 'b失败了：报错', { immediate: true });
    await output.announce('c', 'c还没做完：达到上限', { immediate: true });
    assert.deepEqual(said, ['b失败了：报错', 'c还没做完：达到上限']);
    tick(1500);
    await pending;
    assert.equal(said[2], 'a完成');
  });
  it('提问按 FIFO 串行，等待期间仍可播报', async () => {
    const { output, tick, said } = setup();
    const first = deferred<string>();
    const started: number[] = [];
    const a = output.ask(() => { started.push(1); return first.promise; });
    const b = output.ask(async () => { started.push(2); return '二'; });
    const c = output.ask(async () => { started.push(3); return '三'; });
    await flush();
    assert.deepEqual(started, [1]);
    const announcement = output.announce('a', '做完了');
    tick(1500);
    await announcement;
    assert.deepEqual(said, ['做完了']);
    first.resolve('一');
    assert.deepEqual(await Promise.all([a, b, c]), ['一', '二', '三']);
    assert.deepEqual(started, [1, 2, 3]);
  });
});

describe('边界值', () => {
  it('1499ms 不播，1500ms 播；后续窗口独立', async () => {
    const { output, tick, said } = setup();
    const a = output.announce('a', '第一条');
    tick(1499);
    assert.deepEqual(said, []);
    tick(1);
    await a;
    const b = output.announce('b', '第二条');
    tick(1499);
    assert.deepEqual(said, ['第一条']);
    tick(1);
    await b;
    assert.deepEqual(said, ['第一条', '第二条']);
  });
  it('同一会话只留最后一条且不延长窗口；同名会话不去重', async () => {
    const { output, tick, said } = setup();
    const a = output.announce('a', '旧');
    tick(1000);
    const b = output.announce('a', '新');
    tick(500);
    await Promise.all([a, b]);
    assert.deepEqual(said, ['新']);
    const c = output.announce('a', '完成', { title: '同名' });
    const d = output.announce('b', '完成', { title: '同名' });
    tick(1500);
    await Promise.all([c, d]);
    assert.equal(said[1], '同名 和 同名 都做完了');
  });
  it('移出托管的排队问题丢弃，后续问题继续', async () => {
    const { output, managed } = setup();
    const hold = deferred<string>();
    const a = output.ask(() => hold.promise);
    let called = false;
    const b = output.ask(async () => { called = true; return '旧问题'; }, { session: 'a' });
    managed.delete('a');
    hold.resolve('回答');
    assert.deepEqual(await Promise.all([a, b]), ['回答', undefined]);
    assert.equal(called, false);
  });
  it('显式移出会清除排队问题，重新托管不恢复旧问题', async () => {
    const { output } = setup();
    const hold = deferred<string>();
    const a = output.ask(() => hold.promise);
    await flush();
    const b = output.ask(async () => assert.fail('旧问题不应执行'), { session: 'a' });
    output.dropSession('a');
    assert.equal(await b, undefined);
    hold.resolve('完成');
    await a;
  });
  it('卸载清除窗口和排队问题，后续调用无操作', async () => {
    const { output, tick, said, timers } = setup();
    const hold = deferred<string>();
    const a = output.ask(() => hold.promise);
    await flush();
    const b = output.ask(async () => assert.fail('卸载不启动问题'));
    const speech = output.announce('a', '完成');
    output.dispose();
    assert.equal(await b, undefined);
    await speech;
    assert.equal(timers.size, 0);
    tick(2000);
    await output.announce('b', '卸载后');
    assert.equal(await output.ask(async () => '卸载后'), undefined);
    assert.deepEqual(said, []);
    hold.resolve('已在问的答案');
    await a;
  });
});

describe('异常路径', () => {
  it('窗口到期后、实际播报开始前卸载，不再播报', async () => {
    const { output, tick, said } = setup();
    const pending = output.announce('a', '旧实例播报');
    tick(1500);
    output.dispose();
    await pending;
    assert.deepEqual(said, []);
  });

  it('同步抛错和异步拒绝均不阻塞后续提问', async () => {
    const { output } = setup();
    const a = output.ask(() => { throw new Error('sync'); });
    const b = output.ask(async () => { throw new Error('async'); });
    const c = output.ask(async () => '成功');
    await assert.rejects(a, /sync/);
    await assert.rejects(b, /async/);
    assert.equal(await c, '成功');
  });
  it('排队取消后不提问，也不阻塞下一项', async () => {
    const { output } = setup();
    const hold = deferred<string>();
    const a = output.ask(() => hold.promise);
    const controller = new AbortController();
    const b = output.ask(async () => assert.fail('已取消'), { signal: controller.signal });
    controller.abort();
    assert.equal(await b, undefined);
    hold.resolve('第一项');
    await a;
    assert.equal(await output.ask(async () => '下一项'), '下一项');
  });
  it('播报失败拒绝对应 promise，后续窗口仍工作', async () => {
    const failure = new Error('TTS failed');
    let fail = true;
    let timer!: () => void;
    const output = new OutputCoordinator({ say: () => { if (fail) throw failure; },
      clock: { setTimeout: fn => { timer = fn; return 1; }, clearTimeout() {} } });
    const a = output.announce('a', '完成');
    const b = output.announce('b', '完成');
    const checked = Promise.all([assert.rejects(a, /TTS failed/), assert.rejects(b, /TTS failed/)]);
    timer();
    await checked;
    await assert.rejects(output.announce('c', '失败', { immediate: true }), /TTS failed/);
    fail = false;
    const next = output.announce('a', '恢复');
    timer();
    await next;
  });
});
