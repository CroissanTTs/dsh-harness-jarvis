import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { apply } from '../src/index.ts';

let dir: string;
let dispose: (() => void) | void;
let services: Record<string, any>;
let listeners: Map<string, ((...args: any[]) => unknown)[]>;
let injections: { names: string[]; callback: (ctx: any) => void }[];
let context: any;
let session: any;
let title: unknown;
let reads: any[];
let renames: any[][];
let messages: unknown[];
let warnings: string[];
let handle: any;
let resolveCreate: (handle: any) => void;
let rejectCreate: (error: Error) => void;
let resolveResume: (handle: any) => void;
let rejectResume: (error: Error) => void;
let resumeCalls: number;
let handler: any;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jv-title-wiring-'));
  listeners = new Map();
  injections = [];
  title = '自动生成的标题';
  reads = [];
  renames = [];
  messages = [];
  warnings = [];
  resumeCalls = 0;
  session = { id: 'jarvis-title-test' };
  handle = { agent: { followup: (message: unknown) => messages.push(message) },
    session: { deriveMessages: () => { throw new Error('不应读取诊断消息'); } } };
  mock.method(childProcess, 'spawn', () => Object.assign(new EventEmitter(), {
    unref() {}, kill() {}, killed: false,
  }));
  syncBuiltinESMExports();
  services = {
    sessions: new Map([[session.id, session]]),
    sessionTitle: {
      get: (value: any) => { reads.push(value); return title; },
      rename: (value: any, wanted: string) => { renames.push([value, wanted]); title = wanted; },
    },
    agentLoop: {
      createAgent: () => new Promise((resolve, reject) => { resolveCreate = resolve; rejectCreate = reject; }),
      resume: () => {
        resumeCalls++;
        return new Promise((resolve, reject) => { resolveResume = resolve; rejectResume = reject; });
      },
    },
    webServer: { register: (route: any) => { handler = route.handler; } },
  };
  context = {
    get: (name: string) => services[name],
    inject: (names: string[], callback: (ctx: any) => void) => {
      injections.push({ names, callback });
      if (names.every(name => name in services)) callback(context);
    },
    provide: (name: string, service: unknown) => { services[name] = service; },
    on: (name: string, callback: (...args: any[]) => unknown) => {
      listeners.set(name, [...(listeners.get(name) ?? []), callback]);
    },
    logger: { warn: (message: string) => warnings.push(message) },
  };
  await startPlugin();
});

async function startPlugin(): Promise<void> {
  dispose?.();
  injections.length = 0;
  listeners.clear();
  dispose = apply(context, {
    jarvisSessionId: session.id, audioDir: dir, memoryRoot: dir, lockFile: join(dir, 'lock.json'),
    managedFile: join(dir, 'managed.json'), tasksFile: join(dir, 'tasks.json'),
    runtimeFile: join(dir, 'runtime.json'),
  });
  // Keep the resume greeting within the real route's muted path.
  const req = Object.assign(new EventEmitter(), {
    url: '/jarvis/voice', method: 'POST', socket: { remoteAddress: '127.0.0.1' },
    headers: { authorization: `Bearer ${JSON.parse(readFileSync(join(dir, 'runtime.json'), 'utf8')).token}` },
  });
  const pending = handler(req, { writeHead() {}, end() {} });
  req.emit('data', Buffer.from('{"action":"mute"}'));
  req.emit('end');
  await pending;
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  mock.restoreAll();
  syncBuiltinESMExports();
  rmSync(dir, { recursive: true, force: true });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
}

function attachTitle(service = services.sessionTitle): void {
  services.sessionTitle = service;
  for (const { names, callback } of [...injections]) {
    if (names.includes('sessionTitle') && names.every(name => name in services)) callback(context);
  }
}

function endTurn(): void {
  for (const listener of listeners.get('session/event') ?? []) {
    listener(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  }
}

describe('等价类', () => {
  it('创建成功后用 sessions 中的会话对象读取并 rename，随后仍启动首轮', async () => {
    assert.equal(reads.length, 0);
    resolveCreate(handle);
    await flush();
    assert.deepEqual(reads, [session]);
    assert.deepEqual(renames, [[session, '贾维斯']]);
    assert.equal(messages.length, 1);
  });

  it('恢复成功后设置标题，恢复完成之前不写入', async () => {
    rejectCreate(new Error('session already exists'));
    await flush();
    assert.equal(resumeCalls, 1);
    assert.equal(reads.length, 0);
    resolveResume(handle);
    await flush();
    assert.deepEqual(renames, [[session, '贾维斯']]);
    assert.match(readFileSync(join(dir, 'debug.log'), 'utf8'), /speakGreeting:.*muted/);
  });

  it('标题已相同时读取一次但不追加 rename', async () => {
    title = '贾维斯';
    resolveCreate(handle);
    await flush();
    assert.deepEqual(reads, [session]);
    assert.deepEqual(renames, []);
  });
});

describe('边界值', () => {
  it('标题服务晚到时在创建成功后仅尝试一次，服务重注入不重复', async () => {
    const service = services.sessionTitle;
    delete services.sessionTitle;
    await startPlugin();
    resolveCreate(handle);
    await flush();
    assert.equal(reads.length, 0);
    attachTitle(service);
    await flush();
    assert.deepEqual(renames, [[session, '贾维斯']]);
    title = '其他标题';
    attachTitle(service);
    await flush();
    assert.equal(reads.length, 1);
  });

  it('轮末不重设标题，也不派生消息或留下诊断日志', async () => {
    resolveCreate(handle);
    await flush();
    title = '用户改过的标题';
    for (let i = 0; i < 3; i++) endTurn();
    await flush();
    assert.equal(reads.length, 1);
    assert.equal(renames.length, 1);
    assert.doesNotMatch(readFileSync(join(dir, 'debug.log'), 'utf8'), /jarvis turn\/end:|titleService no set/);
  });
});

describe('异常路径', () => {
  it('创建失败且无法恢复时不尝试标题', async () => {
    rejectCreate(new Error('provider unavailable'));
    await flush();
    attachTitle();
    assert.equal(reads.length, 0);
    assert.equal(resumeCalls, 0);
  });

  it('恢复失败时不尝试标题', async () => {
    rejectCreate(new Error('session already exists'));
    await flush();
    rejectResume(new Error('session not live'));
    await flush();
    attachTitle();
    assert.equal(reads.length, 0);
  });

  it('会话不存在时跳过，仍启动首轮', async () => {
    services.sessions.clear();
    resolveCreate(handle);
    await flush();
    assert.deepEqual(renames, []);
    assert.equal(messages.length, 1);
  });

  for (const failure of ['sessions', 'get', 'rename', 'async rename']) {
    it(`${failure} 抛错只写 debug，且不阻断启动或重复尝试`, async () => {
      const fail = () => { throw new Error(`${failure} unavailable`); };
      if (failure === 'sessions') services.sessions.get = fail;
      else if (failure === 'get') services.sessionTitle.get = fail;
      else if (failure === 'rename') services.sessionTitle.rename = fail;
      else services.sessionTitle.rename = async () => fail();
      const titleService = services.sessionTitle;
      resolveCreate(handle);
      await flush();
      const log = readFileSync(join(dir, 'debug.log'), 'utf8');
      assert.match(log, new RegExp(`trySetTitle failed: ${failure} unavailable`));
      assert.equal(messages.length, 1);
      assert.equal(resumeCalls, 0);
      assert.ok(warnings.every(message => !message.includes('unavailable')));
      attachTitle(titleService);
      endTurn();
      await flush();
      assert.equal(readFileSync(join(dir, 'debug.log'), 'utf8').split('trySetTitle failed:').length - 1, 1);
    });
  }
});
