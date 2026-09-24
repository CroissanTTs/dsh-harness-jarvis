import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { apply } from '../src/index.ts';
import { OutputCoordinator } from '../src/output.ts';
let dir: string, dispose: (() => void) | void, values: any, hooks: any, installed: any, options: any;
let services: any, ctx: any, deferredSettings: any, tools: Map<string, any>, listeners: Map<string, any[]>;
let calls: any[], announcements: string[];
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jv-settings-')); values = {}; hooks = undefined; installed = undefined;
  tools = new Map(); listeners = new Map(); calls = []; announcements = [];
  mock.method(OutputCoordinator.prototype, 'announce', async (_session: string, text: string) => { announcements.push(text); });
  services = { agents: new Map([['worker', { status: 'idle', followup() {}, session: { deriveMessages: () => [
    { role: 'assistant', content: [{ type: 'text', text: '完成工作' }] },
  ] } }]]), llm: { async *stream(request: any) {
    calls.push(request); yield { type: 'text-delta', text: '{"verdict":"unsatisfied","summary":"未完成","missing":"补测试"}' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } }, settings: { installSection(owner: any, ns: string, schema: any, base: any, h: any) {
    installed = { owner, ns, schema, base }; hooks = h;
    h.setSource(() => ({ ...base, ...values })); h.onChange();
  } }, agentLoop: { createAgent(_owner: any, opts: any) {
    options = opts; opts.setup(ctx); return new Promise(() => {});
  } } };
  ctx = { get: (name: string) => services[name], provide(name: string, service: any) { services[name] = service; },
    inject(names: string[], callback: any) {
      if (names[0] === 'settings') deferredSettings = callback;
      if (names.every(name => name in services)) callback(ctx);
    }, on(name: string, callback: any) { listeners.set(name, [...(listeners.get(name) ?? []), callback]); },
    tools: { register: (tool: any) => tools.set(tool.name, tool) }, logger: { warn() {} } };
});
afterEach(async () => { dispose?.(); await flush(); mock.restoreAll(); mock.timers.reset(); syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); });
function start(extra = {}) {
  dispose = apply(ctx, { audioDir: dir, memoryRoot: dir, lockFile: join(dir, 'lock.json'), managedFile: join(dir, 'managed.json'),
    tasksFile: join(dir, 'tasks.json'), runtimeFile: join(dir, 'runtime.json'), provider: 'base', model: 'base-model', ...extra });
}
async function turn() {
  await tools.get('manage_session').execute({ session: 'worker' });
  await tools.get('inject_to_session').execute({ session: 'worker', message: '修好测试' });
  for (const cb of listeners.get('session/event') ?? []) cb({ id: 'worker' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  await flush();
}
const task = () => JSON.parse(readFileSync(join(dir, 'tasks.json'), 'utf8')).at(-1);
describe('等价类', () => {
  it('installs only supported editable fields in jarvis with restart descriptions', () => {
    start(); assert.equal(installed.ns, 'jarvis'); assert.equal(installed.owner, ctx);
    assert.deepEqual(Object.keys(installed.schema.dict).sort(), ['provider','model','edgeVoice','greetings','askInterception','autoApprove','judgeEnabled','judgeProvider','judgeModel','judgeTimeoutMs','maxContinueRounds'].sort());
    assert.match(installed.schema.dict.provider.meta.description, /重启 DSH/);
    assert.match(installed.schema.dict.model.meta.description, /重启 DSH/);
    assert.ok(!('runtimeFile' in installed.base));
  });
  it('loads persisted models before creation and live judge changes on next turn', async () => {
    values = { provider: 'saved', model: 'saved-model', judgeProvider: 'judge', judgeModel: 'judge-model', maxContinueRounds: 0 };
    start(); assert.deepEqual(options.agentOptions, { provider: 'saved', model: 'saved-model' });
    await turn(); assert.equal(calls[0].provider, 'judge'); assert.equal(calls[0].model, 'judge-model');
    assert.equal(task().status, 'done'); assert.match(announcements[0], /已经续了 0 次/);
    values = { judgeEnabled: false }; hooks.onChange(); await turn(); assert.equal(calls.length, 1);
    assert.equal(task().lastVerdict.verdict, 'unclear');
  });
  it('updates built-in voice on the next utterance and never reuses another voice cache', async () => {
    const synth: string[][] = [];
    mock.method(childProcess, 'spawn', (command: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), { killed: false, unref() {}, kill() {} });
      setImmediate(() => {
        if (command === process.execPath) { synth.push(args); writeFileSync(args[2], 'audio'); }
        child.emit('close', 0);
      });
      return child;
    });
    syncBuiltinESMExports(); start();
    await tools.get('say_to_user').execute({ text: '同一句' }); await flush();
    values = { edgeVoice: 'en-US-GuyNeural' }; hooks.onChange();
    await tools.get('say_to_user').execute({ text: '同一句' }); await flush();
    assert.equal(synth.length, 2); assert.equal(synth[0][3], 'zh-CN-YunjianNeural'); assert.equal(synth[1][3], 'en-US-GuyNeural');
    assert.notEqual(synth[0][2], synth[1][2]);
    await tools.get('say_to_user').execute({ text: '同一句' }); await flush(); assert.equal(synth.length, 2);
  });
  it('keeps running agent model stable on watch and resets live values on provider detach', async () => {
    start(); values = { provider: 'future', model: 'future-model', judgeProvider: 'new', judgeModel: 'new-model' }; hooks.onChange();
    assert.deepEqual(options.agentOptions, { provider: 'base', model: 'base-model' });
    hooks.setSource(() => installed.base); hooks.onChange(); await turn();
    assert.equal(calls[0].provider, 'base'); assert.equal(calls[0].model, 'base-model');
  });
});
describe('边界值', () => {
  it('late settings service changes judge but does not recreate or switch running agent', async () => {
    const service = services.settings; delete services.settings; start(); services.settings = service;
    values = { provider: 'later', model: 'later-model', judgeModel: 'later-judge', maxContinueRounds: 0 }; deferredSettings(ctx);
    await turn(); assert.equal(calls[0].provider, 'base'); assert.equal(calls[0].model, 'later-judge');
    assert.deepEqual(options.agentOptions, { provider: 'base', model: 'base-model' });
  });
  it('changed judge timeout bounds an uncooperative stream at the new deadline', async () => {
    start(); values = { judgeTimeoutMs: 1000 }; hooks.onChange();
    services.llm.stream = (request: any) => { calls.push(request); return { [Symbol.asyncIterator]() { return {
      next: () => new Promise(() => {}), return: async () => ({ done: true }),
    }; } }; };
    mock.timers.enable({ apis: ['setTimeout'] });
    await turn(); assert.equal(task().status, 'judging');
    mock.timers.tick(999); await flush(); assert.equal(task().status, 'judging');
    mock.timers.tick(1); await flush(); assert.equal(task().status, 'done'); assert.equal(calls[0].signal.aborted, true);
  });
  it('schema bounds reject oversized or fractional limits', () => {
    start(); for (const value of [-1, 11, 1.5]) assert.throws(() => installed.schema({ maxContinueRounds: value }));
    for (const value of [999, 120001]) assert.throws(() => installed.schema({ judgeTimeoutMs: value }));
  });
});
describe('异常路径', () => {
  for (const mode of ['missing', 'old', 'throws']) it(`continues with composition when settings ${mode}`, async () => {
    if (mode === 'missing') delete services.settings;
    if (mode === 'old') services.settings = {};
    if (mode === 'throws') services.settings.installSection = () => { throw new Error('registration failed'); };
    start(); await turn(); assert.equal(calls[0].provider, 'base'); assert.ok(tools.has('remember'));
  });
  it('retains effective config if settings source temporarily throws and recovers', async () => {
    start(); values = { judgeModel: 'valid' }; hooks.onChange();
    hooks.setSource(() => { throw new Error('read failed'); }); hooks.onChange();
    await turn(); assert.equal(calls[0].model, 'valid');
    hooks.setSource(() => installed.base); hooks.onChange();
  });
  it('ignores late callbacks after plugin disposal', () => {
    start(); dispose?.(); dispose = undefined;
    hooks.setSource(() => { throw new Error('must not read'); }); assert.doesNotThrow(() => hooks.onChange());
  });
});
