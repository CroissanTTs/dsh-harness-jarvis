import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { apply } from '../src/index.ts';

let dir: string;
let disposers: (() => void)[];
let children: any[];
let timers: { callback: () => void; delay: number; cleared: boolean; unrefs: number }[];
let injections: (() => void)[];
let speech: string[];
let now: number;
let missing: boolean;
let spawnFailure: Error | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'jv-panel-wiring-'));
  disposers = []; children = []; timers = []; injections = []; speech = [];
  now = 0; missing = false; spawnFailure = undefined;
  const exists = fs.existsSync;
  mock.method(fs, 'existsSync', (path: fs.PathLike) => String(path).endsWith('/macos/jarvis-panel') ? !missing : exists(path));
  mock.method(childProcess, 'spawn', () => {
    if (spawnFailure) throw spawnFailure;
    const child = Object.assign(new EventEmitter(), {
      pid: children.length + 1, killed: false, unrefs: 0,
      unref() { this.unrefs++; },
      kill(signal: string) { this.killed = true; this.emit('exit', null, signal); },
    });
    children.push(child);
    return child;
  });
  syncBuiltinESMExports();
  mock.method(Date, 'now', () => now);
  mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false, unrefs: 0, unref() { this.unrefs++; return this; } };
    timers.push(timer);
    return timer;
  });
  mock.method(globalThis, 'clearTimeout', (timer: any) => { if (timer) timer.cleared = true; });
  mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
    if (options?.method === 'POST') speech.push(JSON.parse(options.body).text);
    return { ok: true, status: 200 };
  });
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  mock.restoreAll(); syncBuiltinESMExports();
  fs.rmSync(dir, { recursive: true, force: true });
});

function start(deferred = false): () => void {
  const context: any = {
    get: (name: string) => name === 'webServer' ? { port: 9999, register() {} } : undefined,
    inject: (names: string[], callback: (context: any) => void) => {
      if (names[0] === 'webServer') {
        injections.push(() => callback(context));
        if (!deferred) callback(context);
      }
    },
    provide() {}, on() {}, logger: { warn() {} },
  };
  const firstApplyTimer = timers.length;
  const dispose = apply(context, {
    audioDir: dir, managedFile: join(dir, 'managed.json'), tasksFile: join(dir, 'tasks.json'),
    runtimeFile: join(dir, 'runtime.json'),
  })!;
  // apply schedules startup cache maintenance before services can spawn a panel.
  // Isolate that exact registration, not all 30s timers: backoff also reaches 30s.
  const [maintenanceTimer] = timers.splice(firstApplyTimer, 1);
  assert.equal(maintenanceTimer?.delay, 30_000);
  assert.equal(maintenanceTimer?.unrefs, 1);
  disposers.push(dispose);
  return dispose;
}

function crash(code: number | null = 1, signal: string | null = null): void {
  children.at(-1).emit('exit', code, signal);
}
function fire(timer = timers.at(-1)!): void { now += timer.delay; timer.callback(); }
async function flush(): Promise<void> { await new Promise(resolve => setImmediate(resolve)); }

describe('等价类', () => {
  it('崩溃按1/5/30秒重启，进程和定时器均unref', () => {
    start();
    for (const delay of [1000, 5000, 30000]) {
      const child = children.at(-1);
      child.emit('spawn');
      assert.equal(child.unrefs, 1);
      crash();
      const timer = timers.at(-1)!;
      assert.equal(timer.delay, delay);
      assert.equal(timer.unrefs, 1);
      const count = children.length;
      fire();
      assert.equal(children.length, count + 1);
    }
  });
  it('手动退出和单实例退出不拉起', () => {
    start(); crash(0);
    assert.equal(timers.length, 0);
  });
  it('外部SIGTERM属于崩溃，自身卸载SIGTERM不重启', () => {
    const dispose = start(); crash(null, 'SIGTERM');
    assert.equal(timers.length, 1);
    fire(); dispose();
    assert.equal(timers.length, 1);
  });
});

describe('边界值', () => {
  it('第四次崩溃只播报一次并留下停止日志', async () => {
    start();
    for (let i = 0; i < 3; i++) { crash(); fire(); }
    const child = children.at(-1);
    crash(); child.emit('exit', 1, null); child.emit('error', new Error('late error'));
    await flush();
    assert.equal(children.length, 4);
    assert.deepEqual(speech, ['悬浮窗反复崩溃，已停止自动重启']);
    assert.match(fs.readFileSync(join(dir, 'debug.log'), 'utf8'), /panel.*crash-limit/);
    assert.equal(timers.filter(timer => timer.unrefs === 1).length, 3);
  });
  it('同一webServer重复注入不替换现有进程', () => {
    start(); injections[0]();
    assert.equal(children.length, 1);
    assert.equal(children[0].killed, false);
  });
  it('稳定10分钟后重新从1秒开始', () => {
    start(); children[0].emit('spawn'); crash(); fire();
    children[1].emit('spawn'); now += 600000;
    crash(); assert.equal(timers.at(-1)!.delay, 1000);
  });
});

describe('异常路径', () => {
  it('卸载清理待执行timer，已排队回调和迟到exit也不重启', () => {
    const dispose = start(); const child = children[0]; crash();
    const timer = timers.at(-1)!;
    assert.ok(timer, '崩溃应安排定时器');
    dispose(); assert.equal(timer.cleared, true);
    fire(timer); child.emit('exit', 1, null);
    assert.equal(children.length, 1); assert.equal(timers.length, 1);
  });
  it('重新apply后旧disposer和旧child事件不能清理或重启新实例', () => {
    const disposeOld = start(); const old = children[0];
    start(); const current = children[1];
    assert.equal(old.killed, true);
    disposeOld(); old.emit('exit', 1, null); old.emit('error', new Error('late'));
    assert.equal(current.killed, false); assert.equal(timers.length, 0);
    crash(); assert.equal(timers.at(-1)!.delay, 1000);
  });
  it('同实例重启后旧child迟到事件不能覆盖当前child或重复计数', () => {
    start(); const old = children[0]; crash(); fire();
    old.emit('spawn'); old.emit('exit', 1, null); old.emit('error', new Error('late'));
    assert.equal(timers.length, 1);
    crash(); assert.equal(timers.length, 2); assert.equal(timers.at(-1)!.delay, 5000);
  });
  it('重新apply取消旧实例待执行重启', () => {
    start(); crash(); const timer = timers.at(-1)!;
    assert.ok(timer, '崩溃应安排定时器');
    start(); assert.equal(timer.cleared, true); fire(timer);
    assert.equal(children.length, 2);
  });
  it('卸载后迟到webServer注入不能启动进程', () => {
    start(true)(); injections[0](); assert.equal(children.length, 0);
  });
  it('旧apply尚未注入webServer就被替换时不得夺回新进程', () => {
    start(true); start(); injections[0](); assert.equal(children.length, 1);
  });
  it('异步spawn error按崩溃重试且后续exit不重复安排', () => {
    start(); const child = children[0];
    assert.doesNotThrow(() => child.emit('error', new Error('ENOENT')));
    child.emit('exit', -2, null);
    assert.equal(timers.length, 1); assert.equal(timers[0].delay, 1000);
    fire(); assert.equal(children.length, 2);
  });
  it('同步spawn异常也按退避重试', () => {
    spawnFailure = new Error('EACCES'); assert.doesNotThrow(() => start());
    assert.equal(timers.length, 1); assert.equal(timers[0].delay, 1000);
    spawnFailure = undefined; fire(); assert.equal(children.length, 1);
  });
  it('面板二进制不存在时仅记录日志', () => {
    missing = true; start();
    assert.equal(children.length, 0); assert.equal(timers.length, 0);
    assert.match(fs.readFileSync(join(dir, 'debug.log'), 'utf8'), /panel binary not found/);
  });
});
