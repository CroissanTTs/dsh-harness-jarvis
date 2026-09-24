import { beforeEach, afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { apply } from '../src/index.ts';
let dir: string, handler: any, service: any, dispose: (() => void) | void;
let toolMap: Map<string, any>, playback: any[], synthesis: any[], failSpawn: boolean;
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jv-caption-wiring-'));
  toolMap = new Map(); playback = []; synthesis = []; failSpawn = false;
  mock.method(childProcess, 'spawn', (cmd: string) => {
    if (cmd === 'afplay' && failSpawn) throw new Error('cannot spawn');
    const child = Object.assign(new EventEmitter(), { unref() {}, killed: false,
      kill() { this.killed = true; this.emit('close', 0); }, stderr: new EventEmitter() });
    if (cmd === 'afplay') playback.push(child);
    else if (cmd === process.execPath) synthesis.push(child);
    return child;
  });
  syncBuiltinESMExports();
  mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404 } as Response));
  const agent: any = { inject() {}, on() {}, tools: { register: (t: any) => toolMap.set(t.name, t) } };
  const services: any = { webServer: { port: 43210, register: (route: any) => { handler = route.handler; } },
    agentLoop: { createAgent: (_: unknown, opts: any) => { opts.setup(agent); return new Promise(() => {}); } } };
  const ctx: any = { get: (name: string) => services[name],
    inject: (names: string[], cb: any) => { if (names.every(n => n in services)) cb(ctx); },
    provide: (_: string, s: any) => { service = s; }, on() {}, logger: { warn() {} } };
  dispose = apply(ctx, { jarvisSessionId: 'jarvis-caption', memoryRoot: dir, audioDir: dir,
    lockFile: join(dir, 'lock.json'), managedFile: join(dir, 'managed.json'), tasksFile: join(dir, 'tasks.json'),
    runtimeFile: join(dir, 'runtime.json') });
  await request('/voice', { action: 'unmute' });
});
afterEach(async () => { dispose?.(); await flush(); mock.restoreAll(); syncBuiltinESMExports(); rmSync(dir, { force: true, recursive: true }); });
async function request(path: string, body?: unknown): Promise<any> {
  const token = JSON.parse(readFileSync(join(dir, 'runtime.json'), 'utf8')).token;
  const req = Object.assign(new EventEmitter(), { method: body ? 'POST' : 'GET', url: '/jarvis' + path,
    socket: { remoteAddress: '127.0.0.1' }, headers: { authorization: `Bearer ${token}` } });
  let output = '';
  const pending = handler(req, { writeHead() {}, end(value: string) { output = value; } });
  if (body) { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); }
  await pending; return JSON.parse(output || '{}');
}
async function say(line: string) {
  writeFileSync(join(dir, `say-${createHash('sha1').update(line).digest('hex').slice(0, 16)}.mp3`), 'fake');
  await toolMap.get('say_to_user').execute({ text: line }); await flush();
}
describe('等价类', () => {
  it('built-in playback exposes text during playback then clears it on close', async () => {
    await say('缓存语音');
    assert.equal((await request('/state')).voice.text, '缓存语音');
    assert.equal((await request('/state')).voice.source, 'jarvis');
    playback[0].emit('close', 0); await flush();
    const state = await request('/state'); assert.equal(state.voice.speaking, false); assert.ok(!('text' in state.voice));
  });
  it('voice-mini service text reaches state with the same source', async () => {
    service.speech({ phase: 'start', id: 'vm-1', source: 'session', sessionId: 'worker', text: '  已完成  ' });
    assert.deepEqual((await request('/state')).voice, { speaking: true, source: 'session', sessionId: 'worker', text: '已完成', muted: false, paused: false, queued: 0 });
    service.speech({ phase: 'end', id: 'vm-1' }); assert.ok(!('text' in (await request('/state')).voice));
  });
});
describe('边界值', () => {
  it('older playback completion does not clear a newer caption', async () => {
    await say('旧句'); await say('新句'); playback[0].emit('close', 0); await flush();
    assert.equal((await request('/state')).voice.text, '新句');
  });
  it('muted speech never publishes a caption', async () => {
    await request('/voice', { action: 'mute' }); await say('静音');
    assert.equal(playback.length, 0); assert.ok(!('text' in (await request('/state')).voice));
  });
});
describe('异常路径', () => {
  it('afplay error and synchronous spawn failure both retire captions', async () => {
    await say('异步错误'); playback[0].emit('error', new Error('playback')); await flush();
    assert.equal((await request('/state')).voice.speaking, false);
    failSpawn = true; await say('启动失败');
    assert.equal((await request('/state')).voice.speaking, false);
  });
  it('synthesis failure does not publish text or start playback', async () => {
    const pending = toolMap.get('say_to_user').execute({ text: '未缓存' }); await flush();
    synthesis[0].emit('close', 1); await pending;
    assert.equal(playback.length, 0); assert.equal((await request('/state')).voice.speaking, false);
  });
});
