import { beforeEach, afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { apply } from '../src/index.ts';
import { LiveState, PENDING_GRACE_MS } from '../src/live-state.ts';
let root: string, handler: any, dispose: (() => void) | void, tools: Map<string, any>, events: Map<string, any>, now: number;
let command: string, workspace: string, held: LiveState, sections: Map<string, any>;
const file = () => join(root, 'memory/preferences/approvals.json');
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jv-presets-wiring-')); workspace = root; command = 'npm test';
  tools = new Map(); events = new Map(); sections = new Map(); now = Date.now();
  mock.method(Date, 'now', () => now);
  mock.method(childProcess, 'spawn', () => Object.assign(new EventEmitter(), { unref() {}, kill() {}, killed: false }));
  syncBuiltinESMExports();
  const hold = LiveState.prototype.holdApproval;
  mock.method(LiveState.prototype, 'holdApproval', function(this: LiveState, ...args: any[]) { held = this; return (hold as any).apply(this, args); });
  const services: any = { sessions: { get: () => ({ header: { cwd: workspace } }) },
    systemPrompt: { section: (section: any) => sections.set(section.name, section) },
    webServer: { port: 43210, register: (route: any) => { handler = route.handler; } },
    agentLoop: { createAgent: (_: unknown, opts: any) => { opts.setup(ctx); return new Promise(() => {}); } } };
  const ctx: any = { get: (name: string) => services[name],
    inject: (names: string[], cb: any) => { if (names.every(n => n in services)) cb(ctx); },
    provide() {}, on: (name: string, cb: any) => events.set(name, cb), tools: { register: (t: any) => tools.set(t.name, t) } };
  dispose = apply(ctx, { jarvisSessionId: 'jarvis-test', memoryRoot: root, audioDir: root,
    lockFile: join(root, 'lock.json'), approvalsDir: join(root, 'memory/approvals'), managedFile: join(root, 'managed.json'),
    tasksFile: join(root, 'tasks.json'), runtimeFile: join(root, 'runtime.json') });
});
afterEach(async () => { dispose?.(); await new Promise(r => setTimeout(r, 30)); mock.restoreAll(); syncBuiltinESMExports(); rmSync(root, { force: true, recursive: true }); });
async function request(path: string, body?: unknown, authorized = true): Promise<any> {
  const token = JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')).token;
  const req = Object.assign(new EventEmitter(), { method: body ? 'POST' : 'GET', url: '/jarvis' + path,
    socket: { remoteAddress: '127.0.0.1' }, headers: authorized ? { authorization: `Bearer ${token}` } : {} });
  let output = ''; const res: any = { statusCode: 200, writeHead(status: number) { this.statusCode = status; }, end(value: string) { output = value; } };
  const pending = handler(req, res);
  if (body) { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); }
  await pending; return { status: res.statusCode, body: JSON.parse(output || '{}') };
}
function approve(next: () => Promise<any> = () => new Promise(() => {})) {
  const done = events.get('approval/request')({ toolName: 'bash', callId: 'call', agent: { id: 'worker', session: {
    deriveMessages: () => [{ role: 'assistant', content: [{ type: 'toolCall', id: 'call', arguments: { command } }] }],
  } } }, next);
  now += PENDING_GRACE_MS;
  return { done, card: held.pending()[0] };
}
async function saved() {
  for (let i = 0; i < 100; i++) { if (existsSync(file())) return JSON.parse(readFileSync(file(), 'utf8')); await new Promise(r => setTimeout(r, 5)); }
  assert.fail('preset not saved');
}
describe('等价类', () => {
  it('authenticated always approves first, persists frozen full cwd, and exposes tools and management routes', async () => {
    const { done, card } = approve(); assert.equal(card.canAlwaysAllow, true);
    assert.equal((await request('/pending/answer', { id: card.id, decision: 'always' })).status, 204);
    assert.equal(await done, 'allowed-once'); assert.equal(existsSync(file()), false);
    workspace = '/changed'; command = 'rm -rf .';
    const [rule] = await saved(); assert.equal(rule.workspace, root); assert.equal(rule.fingerprint, 'bash:npm-test');
    assert.deepEqual((await request('/approval-rules')).body, { rules: [rule] });
    const list = tools.get('list_approval_rules'), remove = tools.get('remove_approval_rule');
    assert.deepEqual(list.output.schema, tools.get('remember').output.schema);
    assert.match((await list.execute({})).text, /bash:npm-test/);
    assert.match(sections.get('jarvis:persona').text(), /list_approval_rules/);
    assert.equal((await request('/approval-rules/remove', rule)).status, 204);
    assert.deepEqual((await request('/approval-rules')).body.rules, []);
    assert.match((await remove.execute(rule)).text, /未找到/);
  });
  it('tool deletes the exact tuple and ordinary approvals do not create presets', async () => {
    const { done, card } = approve(); held.answer({ id: card.id, decision: 'always' }); await done;
    const [rule] = await saved(); assert.match((await tools.get('remove_approval_rule').execute(rule)).text, /已删除/);
    const second = approve(); held.answer({ id: second.card.id, decision: 'allow' }); await second.done;
    await new Promise(r => setTimeout(r, 20)); assert.deepEqual(JSON.parse(readFileSync(file(), 'utf8')), []);
  });
});
describe('边界值', () => {
  it('high command past display truncation cannot receive a forged always', async () => {
    command = 'echo ' + 'x'.repeat(400) + '; rm -rf .';
    const { done, card } = approve(); assert.equal(card.detail.length, 300); assert.equal(card.canAlwaysAllow, false);
    assert.equal((await request('/pending/answer', { id: card.id, decision: 'always' })).status, 400);
    held.answer({ id: card.id, decision: 'allow' }); assert.equal(await done, 'allowed-once'); assert.equal(existsSync(file()), false);
  });
  it('DSH-side decisions never write presets; unknown cwd also hides action', async () => {
    workspace = ''; const { done, card } = approve(async () => 'allowed-once');
    assert.equal(card.canAlwaysAllow, false); assert.equal(await done, 'allowed-once');
    assert.equal((await request('/pending/answer', { id: card.id, decision: 'always' })).status, 404);
    assert.equal(existsSync(file()), false);
  });
});
describe('异常路径', () => {
  it('preset write failure cannot delay or reject the current approval', async () => {
    mkdirSync(join(root, 'memory')); writeFileSync(join(root, 'memory/preferences'), 'blocked');
    const { done, card } = approve(); held.answer({ id: card.id, decision: 'always' });
    assert.equal(await done, 'allowed-once');
    await new Promise(r => setTimeout(r, 25)); assert.equal(readFileSync(join(root, 'memory/preferences'), 'utf8'), 'blocked');
    assert.match(readFileSync(join(root, 'debug.log'), 'utf8'), /approval preset failed/);
  });
  it('routes enforce auth, validate tuple, and never expose a rule-creation API', async () => {
    assert.equal((await request('/approval-rules', undefined, false)).status, 403);
    assert.equal((await request('/approval-rules/remove', {})).status, 400);
    assert.equal((await request('/approval-rules', { fingerprint: 'bash:rm-rf', tool: 'bash', workspace: root })).status, 404);
    await assert.rejects(tools.get('remove_approval_rule').execute({}));
  });
});
