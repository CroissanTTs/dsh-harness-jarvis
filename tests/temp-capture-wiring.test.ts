import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from '../src/index.ts';
import { MemoryStore } from '../src/memory/store.ts';
let root: string, store: MemoryStore, dispose: (() => void) | void;
let listeners: Map<string, any>, tools: Map<string, any>;
const at = Date.parse('2026-09-24T10:00:00Z');
const event = (type: string, data: unknown) => ({ type, time: at, data });
const user = (text: string) => event('user/message', { content: [{ type: 'text', text }] });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jv-temp-wiring-')); listeners = new Map(); tools = new Map();
  await writeFile(join(root, 'managed.json'), '["worker"]');
  const services: Record<string, any> = {
    agents: new Map([['worker', { status: 'idle' }]]),
    agentLoop: { createAgent: async (_: unknown, options: any) => { options.setup(ctx); return { agent: { followup() {} } }; } },
  };
  const ctx: any = { get: (name: string) => services[name], provide() {},
    on: (name: string, fn: any) => listeners.set(name, fn),
    tools: { register: (tool: any) => tools.set(tool.name, tool) },
    inject: (names: string[], callback: any) => { if (names.every(name => name in services)) callback(ctx); },
  };
  dispose = apply(ctx, { memoryRoot: root, audioDir: root, lockFile: join(root, 'lock.json'),
    managedFile: join(root, 'managed.json'), tasksFile: join(root, 'tasks.json'), approvalsDir: join(root, 'memory', 'approvals'), judgeEnabled: false });
  await Promise.resolve(); store = new MemoryStore({ rootDir: root }); await store.ready();
});
afterEach(async () => {
  dispose?.(); await tick(); mock.restoreAll();
  // Joining the same locks lets already accepted fire-and-forget writes finish before removing fixtures.
  for (const id of ['worker', 'jarvis', 'other']) await store.withReadLock(id, () => {});
  await rm(root, { recursive: true, force: true });
});
const emit = (id: string, value: unknown) => listeners.get('session/event')({ id }, value);

describe('等价类', () => {
  it('仅托管worker和贾维斯自身捕获，不接收其他会话', async () => {
    for (const id of ['worker', 'jarvis', 'other']) assert.equal(emit(id, user(id)), undefined);
    assert.equal((await store.readTemp('worker'))[0]?.text, 'worker');
    assert.equal((await store.readTemp('jarvis'))[0]?.text, 'jarvis');
    assert.deepEqual(await store.readTemp('other'), []);
  });
  it('真实tool/result结构查回工具名且temp无输出、参数、推理、其他元数据', async () => {
    const prior = [event('tool/call', { callId: 'c', name: 'bash', arguments: 'ARGS_SECRET' })];
    listeners.get('session/event')({ id: 'worker', eventAt: (seq: number) => prior[seq] }, {
      ...event('tool/result', { message: { source: { kind: 'tool', callId: 'c' }, content: [
        { type: 'tool-result', toolCallId: 'c', isError: true, content: [{ type: 'text', text: 'OUTPUT_SECRET' }] },
      ] }, meta: 'META_SECRET', error: { code: 'ERROR_SECRET' } }), seq: 1,
    });
    emit('worker', event('assistant/message', { message: { content: [
      { type: 'reasoning', text: 'REASONING_SECRET' }, { type: 'tool-call', arguments: 'ARGS_SECRET' }, { type: 'text', text: '完成' },
    ] }, stream: ['STREAM_SECRET'] }));
    const records = await store.readTemp('worker');
    assert.deepEqual(records, [{ session: 'worker', at, type: 'tool/result', tool: 'bash', isError: true },
      { session: 'worker', at, type: 'assistant/message', text: '完成' }]);
    assert.doesNotMatch(await readFile(join(root, 'temp', 'worker', '2026-09-24.jsonl'), 'utf8'), /SECRET/);
  });
  it('写入未完成时事件监听器仍同步返回', { timeout: 2000 }, async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = MemoryStore.prototype.appendTemp;
    let write: Promise<void> | undefined;
    mock.method(MemoryStore.prototype, 'appendTemp', function(this: MemoryStore, ...args: Parameters<MemoryStore['appendTemp']>) {
      entered(); write = pending.then(() => original.apply(this, args)); return write;
    });
    try { assert.equal(emit('worker', user('x')), undefined); await started; }
    finally { release(); await write; }
    assert.equal((await store.readTemp('worker'))[0]?.text, 'x');
  });
});
describe('边界值', () => {
  it('移出托管后立即停止，再纳入后恢复', async () => {
    await tools.get('release_session').execute({ session: 'worker' });
    emit('worker', user('skip'));
    await tools.get('manage_session').execute({ session: 'worker' });
    emit('worker', user('keep'));
    assert.deepEqual((await store.readTemp('worker')).map(record => record.text), ['keep']);
  });
  it('未知事件和缺会话不创建temp记录', async () => {
    emit('worker', event('tool/call', { arguments: 'SECRET' }));
    assert.doesNotThrow(() => listeners.get('session/event')(undefined, user('no session')));
    assert.deepEqual(await store.readTemp('worker'), []);
  });
});
describe('异常路径', () => {
  it('写盘失败只记日志，不抛出事件异常', async () => {
    mock.method(MemoryStore.prototype, 'appendTemp', async () => { throw Error('disk unavailable'); });
    assert.equal(emit('worker', user('x')), undefined);
    await tick();
    assert.match(await readFile(join(root, 'debug.log'), 'utf8'), /temp capture failed: disk unavailable/);
  });
});
