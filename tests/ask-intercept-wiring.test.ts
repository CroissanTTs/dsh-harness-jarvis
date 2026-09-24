import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { apply, Config, SettingsSchema } from '../src/index.ts';
import { LiveState } from '../src/live-state.ts';
import { MemoryStore } from '../src/memory/store.ts';
let dir: string, dispose: (() => void) | void, ctx: any, services: any, hooks: any, patch: any;
let tools: Map<string, any>, listeners: Map<string, any>, calls: any[], forwarded: any[], order: string[], verdict: any, spoken: string[];
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
beforeEach(() => {
  spoken = [];
  mock.method(childProcess, 'spawn', (cmd: string, args: string[]) => { if (cmd === process.execPath) spoken.push(args[1]); const child = Object.assign(new EventEmitter(), { killed: false, unref() {}, kill() {} }); setImmediate(() => child.emit('close', 0)); return child; });
  syncBuiltinESMExports();
  dir = mkdtempSync(join(tmpdir(), 'jv-ask-intercept-')); tools = new Map(); listeners = new Map();
  calls = []; forwarded = []; order = []; patch = {}; verdict = { choice: '两空格', confidence: 0.85 };
  mock.method(LiveState.prototype, 'holdAsk', async (req: any, next: any) => { forwarded.push(req); return next(); });
  services = { agents: new Map([['worker', { status: 'idle', followup() {}, session: { deriveMessages: () => [] } }]]),
    llm: { async *stream(request: any) { calls.push(request); yield { type: 'text-delta', text: JSON.stringify(verdict) }; yield { type: 'finish', reason: { kind: 'stop' } }; } },
    settings: { installSection(_owner: any, _ns: string, _schema: any, base: any, h: any) { hooks = h; h.setSource(() => ({ ...base, ...patch })); h.onChange(); } },
    agentLoop: { createAgent(_owner: any, options: any) { options.setup(ctx); return new Promise(() => {}); } } };
  ctx = { get: (name: string) => services[name], provide(name: string, service: any) { services[name] = service; },
    inject(names: string[], callback: any) { if (names.every(name => name in services)) callback(ctx); },
    on(name: string, cb: any) { listeners.set(name, cb); }, tools: { register(tool: any) { tools.set(tool.name, tool); } }, logger: { warn() {} } };
});
afterEach(async () => { dispose?.(); await flush(); mock.restoreAll(); syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); });
async function start(extra: any = {}) {
  dispose = apply(ctx, { audioDir: dir, memoryRoot: dir, approvalsDir: join(dir, 'approvals'), lockFile: join(dir, 'lock.json'),
    managedFile: join(dir, 'managed.json'), tasksFile: join(dir, 'tasks.json'), runtimeFile: join(dir, 'runtime.json'), ...extra });
  await tools.get('manage_session').execute({ session: 'worker' });
  await tools.get('inject_to_session').execute({ session: 'worker', message: '保留现有项目风格' });
}
function request(): any { return { agent: { id: 'worker' }, questions: [{ id: 'question-id', question: '缩进使用什么？', options: [{ label: '两空格' }, { label: '四空格' }] }] }; }
async function ask(req = request()) {
  return listeners.get('user-questions/request')(req, async () => ({ answers: [{ id: 'question-id', selected: ['人工答案'] }] }));
}
function records(): any[] {
  const temp = join(dir, 'temp', 'worker');
  try { return readdirSync(temp).flatMap(file => readFileSync(join(temp, file), 'utf8').trim().split('\n').map(line => JSON.parse(line))); } catch { return []; }
}
describe('等价类', () => {
  it('is off by default and can be enabled from the live settings page', async () => {
    assert.equal((Config({}) as any).askInterception, false); assert.equal((SettingsSchema({}) as any).askInterception, false);
    await start(); assert.equal((await ask()).answers[0].selected[0], '人工答案'); assert.equal(calls.length, 0);
    patch = { askInterception: true }; hooks.onChange();
    assert.equal((await ask()).answers[0].selected[0], '两空格'); assert.equal(calls.length, 1);
  });
  it('uses task and scoped recall, returns before temp I/O, and records only the accepted answer', async () => {
    mock.method(MemoryStore.prototype, 'appendTemp', async (_session: string, record: any) => { order.push('write'); assert.equal(record.choice, '两空格'); });
    await start({ askInterception: true });
    await tools.get('remember').execute({ content: '缩进使用两空格。', session: 'worker' });
    const answer = await ask(); order.push('answer'); assert.deepEqual(answer, { answers: [{ id: 'question-id', selected: ['两空格'] }] });
    await flush(); assert.deepEqual(order, ['answer', 'write']);
    assert.match(calls[0].messages[0].content[0].text, /保留现有项目风格/);
    assert.match(calls[0].messages[0].content[0].text, /缩进使用两空格/);
  });
});
describe('边界值', () => {
  it('writes one bounded temp record in the worker store without model reasoning', async () => {
    await start({ askInterception: true }); await ask();
    for (let i = 0; i < 100 && records().length === 0; i++) await new Promise(r => setTimeout(r, 5));
    const rows = records(); assert.equal(rows.length, 1); assert.equal(rows[0].type, 'question/auto-answer');
    assert.equal(rows[0].question, '缩进使用什么？'); assert.equal(rows[0].choice, '两空格'); assert.equal(rows[0].confidence, 0.85);
    await flush(); assert.match(spoken[0], /worker问了缩进使用什么？，我替你选了两空格/);
    assert.ok(!('reasoning' in rows[0])); assert.ok(!('memory' in rows[0]));
  });
  it('forwards the original request untouched when uncertain, disabled live or not managed', async () => {
    await start({ askInterception: true }); verdict = { choice: '两空格', confidence: 0.8499 }; const req = request();
    assert.equal((await ask(req)).answers[0].selected[0], '人工答案'); assert.equal(forwarded[0], req);
    patch = { askInterception: false }; hooks.onChange(); await ask(); assert.equal(calls.length, 1);
    patch = { askInterception: true }; hooks.onChange(); await tools.get('release_session').execute({ session: 'worker' });
    await ask(); assert.equal(calls.length, 1); await flush(); assert.equal(records().length, 0);
  });
});
describe('异常路径', () => {
  it('no llm falls through to the existing relay', async () => {
    delete services.llm; await start({ askInterception: true }); await ask(); assert.equal(forwarded.length, 1);
  });
  it('recording failure never rejects or reopens a successfully answered question', async () => {
    mock.method(MemoryStore.prototype, 'appendTemp', async () => { throw Error('readonly disk'); });
    await start({ askInterception: true }); assert.equal((await ask()).answers[0].selected[0], '两空格');
    await flush(); assert.equal(forwarded.length, 0);
  });
});
