import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply, Config } from '../src/index.ts';
import { TaskLedger } from '../src/tasks.ts';
import { LiveState, PENDING_GRACE_MS } from '../src/live-state.ts';

let dir: string, approvals: string, messages: any[], listeners: Map<string, any>, services: Record<string, any>;
let dispose: (() => void) | void;
const user = (text: string) => ({ role: 'user', content: [{ type: 'text', text }] });
const request = () => ({ agent: { id: 'worker', session: { deriveMessages: () => messages } }, toolName: 'bash', callId: 'call' });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jv-approvals-wiring-'));
  approvals = join(dir, 'memory', 'approvals');
  messages = [user('older'), user('latest request'), { role: 'assistant', content: [{ type: 'toolCall', id: 'call', arguments: { command: 'npm test' } }] }];
  listeners = new Map();
  services = { sessions: new Map([['worker', { header: { cwd: '/full/path/to/project' } }]]) };
});
afterEach(async () => {
  dispose?.();
  await new Promise(resolve => setTimeout(resolve, 25));
  mock.restoreAll(); syncBuiltinESMExports();
  rmSync(dir, { recursive: true, force: true });
});
function start(overrides: Record<string, unknown> = {}) {
  const ctx: any = { get: (name: string) => services[name], provide() {}, inject() {},
    on: (name: string, callback: any) => listeners.set(name, callback) };
  dispose = apply(ctx, { audioDir: dir, approvalsDir: approvals, managedFile: join(dir, 'managed.json'),
    tasksFile: join(dir, 'tasks.json'), lockFile: join(dir, 'lock.json'), ...overrides });
}
async function files(count = 1): Promise<string[]> {
  for (let i = 0; i < 100; i++) {
    const names = existsSync(approvals) ? readdirSync(approvals).filter(n => n.endsWith('.html')) : [];
    if (names.length >= count) return names.map(name => readFileSync(join(approvals, name), 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('approval HTML was not published');
}
const outcome = (value: string) => listeners.get('approval/request')(request(), async () => value);

describe('等价类', () => {
  it('DSH 批准先返回，文件系统尚未调用，随后记录未托管上下文和完整 cwd', async () => {
    start();
    let writes = 0;
    const original = fsPromises.mkdir;
    mock.method(fsPromises, 'mkdir', (...args: any[]) => { writes++; return (original as any)(...args); });
    syncBuiltinESMExports();
    assert.equal(await outcome('allowed-once'), 'allowed-once');
    assert.equal(writes, 0);
    assert.equal(existsSync(approvals), false);
    const [html] = await files();
    assert.match(html, /managed="false"/);
    assert.match(html, /cwd="\/full\/path\/to\/project"/);
    assert.match(html, /<context>latest request<\/context>/);
    assert.match(html, /allow="true" source="user" reason=""/);
  });
  it('台账原话优先并在等待及后续轮次变化前保存操作快照', async () => {
    const ledger = new TaskLedger(join(dir, 'tasks.json'));
    ledger.expect('worker', '用户原话'); ledger.open('worker', '改写需求');
    writeFileSync(join(dir, 'managed.json'), '["worker"]');
    const command = 'echo ' + 'x'.repeat(400);
    messages[2].content[0].arguments.command = command;
    start();
    const pending = outcome('rejected');
    messages = [user('changed')];
    assert.equal(await pending, 'rejected');
    services.sessions.get('worker').header.cwd = '/changed';
    const [html] = await files();
    assert.match(html, /<context>用户原话<\/context>/);
    assert.match(html, /managed="true"/);
    assert.ok(html.includes(`command="${command}"`));
    assert.match(html, /cwd="\/full\/path\/to\/project"/);
    assert.match(html, /allow="false" source="user" reason="">拒绝/);
  });
  it('面板拒绝经过真实 holdApproval 并记录一次', async () => {
    let now = Date.now();
    mock.method(Date, 'now', () => now);
    start();
    const hold = LiveState.prototype.holdApproval;
    mock.method(LiveState.prototype, 'holdApproval', function(this: LiveState, ...args: any[]) {
      const pending = (hold as any).apply(this, args);
      now += PENDING_GRACE_MS;
      const card = this.pending()[0];
      this.answer({ id: card.id, decision: 'deny' });
      return pending;
    });
    assert.equal(await listeners.get('approval/request')(request(), () => new Promise(() => {})), 'rejected');
    assert.equal((await files()).length, 1);
  });
  it('path 工具及字符串参数保留原始信息', async () => {
    messages[2].content[0].arguments = '{"path":"/tmp/test.txt"}';
    start();
    await listeners.get('approval/request')({ ...request(), toolName: 'read_file' }, async () => 'allowed-once');
    const [html] = await files();
    assert.match(html, /fingerprint="read_file:test.txt"/);
    assert.match(html, /command="\/tmp\/test.txt"/);
    assert.match(html, /args="\{&quot;path&quot;:&quot;\/tmp\/test.txt&quot;\}"/);
  });
});
describe('边界值', () => {
  it('任务刚过24小时，审批返回前不隐式写台账且上下文回退用户消息', async () => {
    let now = Date.now();
    mock.method(Date, 'now', () => now);
    const ledger = new TaskLedger(join(dir, 'tasks.json'));
    ledger.open('worker', 'expired task');
    start();
    const before = readFileSync(join(dir, 'tasks.json'), 'utf8');
    now += 24 * 60 * 60_000 + 1;
    let writes = 0;
    for (const name of ['writeFileSync', 'renameSync', 'appendFileSync', 'mkdirSync'] as const) {
      const original = fs[name];
      mock.method(fs, name, (...args: any[]) => { writes++; return (original as any)(...args); });
    }
    syncBuiltinESMExports();
    assert.equal(await outcome('allowed-once'), 'allowed-once');
    assert.equal(writes, 0);
    assert.equal(readFileSync(join(dir, 'tasks.json'), 'utf8'), before);
    const [html] = await files();
    assert.match(html, /<context>latest request<\/context>/);
    assert.equal(readFileSync(join(dir, 'tasks.json'), 'utf8'), before);
  });
  it('默认目录符合规格', () => { assert.equal((Config({}) as any).approvalsDir, '~/.dsh/jarvis/memory/approvals'); });
  for (const length of [299, 300, 301]) it(`最近用户文本 ${length} 字截断为最多300字`, async () => {
    messages.unshift(user('should not win'));
    messages[2] = user('字'.repeat(length));
    start(); await outcome('allowed-once');
    assert.ok((await files())[0].includes(`<context>${'字'.repeat(Math.min(length, 300))}</context>`));
  });
  it('缺少消息、tool call、cwd 时仍记录空上下文', async () => {
    messages = []; services.sessions.clear(); start(); await outcome('rejected');
    const [html] = await files();
    assert.match(html, /command="" args=""/); assert.match(html, /cwd=""/); assert.match(html, /<context><\/context>/);
  });
  it('cancelled 和 unavailable 不创建记录目录', async () => {
    start();
    for (const result of ['cancelled', 'unavailable']) assert.equal(await outcome(result), result);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(existsSync(approvals), false);
  });
});
describe('异常路径', () => {
  it('元数据读取失败不影响审批，下一轮才记录错误', async () => {
    start();
    mock.method(TaskLedger.prototype, 'peekCurrent', () => { throw new Error('metadata unavailable'); });
    assert.equal(await outcome('rejected'), 'rejected');
    assert.equal(readFileSync(join(dir, 'debug.log'), 'utf8').includes('metadata unavailable'), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(readFileSync(join(dir, 'debug.log'), 'utf8'), /metadata unavailable/);
  });
  it('落盘及日志目录损坏不影响已经返回的允许结果', async () => {
    writeFileSync(approvals = join(dir, 'blocked'), 'keep');
    const audio = join(dir, 'audio-file'); writeFileSync(audio, 'keep');
    start({ audioDir: audio });
    assert.equal(await outcome('allowed-once'), 'allowed-once');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(readFileSync(approvals, 'utf8'), 'keep');
  });
  it('下游审批抛错保持原错误且不创建记录', async () => {
    start();
    await assert.rejects(listeners.get('approval/request')(request(), async () => { throw new Error('approval failed'); }), /approval failed/);
    assert.equal(existsSync(approvals), false);
  });
});
