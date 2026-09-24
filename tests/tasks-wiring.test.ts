import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { apply } from '../src/index.ts';

let dir: string;
let dispose: (() => void) | void;
let tools: Map<string, any>;
let workers: Map<string, any>;
let workerMessages: unknown[];
let jarvisMessages: unknown[];
let jarvis: any;
let handler: any;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jv-tasks-wiring-'));
  tools = new Map();
  workerMessages = [];
  jarvisMessages = [];
  jarvis = { followup: (msg: unknown) => jarvisMessages.push(msg) };
  workers = new Map(['a', 'b'].map(id => [id, {
    status: 'idle', followup: (msg: unknown) => workerMessages.push(msg),
  }]));
  // Exercise plugin routes and tools without starting the native panel.
  mock.method(childProcess, 'spawn', () => Object.assign(new EventEmitter(), {
    unref() {}, kill() {}, killed: false,
  }));
  syncBuiltinESMExports();
  const services: Record<string, any> = {
    agents: workers,
    webServer: { register: (route: any) => { handler = route.handler; } },
    agentLoop: { createAgent: async (_owner: unknown, options: any) => {
      options.setup(ctx);
      return { agent: jarvis };
    } },
  };
  const ctx: any = {
    get: (name: string) => services[name],
    inject: (names: string[], callback: (ctx: any) => void) => {
      if (names.every(name => name in services)) callback(ctx);
    },
    provide() {}, on() {},
    tools: { register: (tool: any) => tools.set(tool.name, tool) },
  };
  dispose = apply(ctx, {
    audioDir: dir, managedFile: join(dir, 'managed.json'),
    tasksFile: join(dir, 'tasks.json'), runtimeFile: join(dir, 'runtime.json'),
  });
  await Promise.resolve();
  jarvisMessages.length = 0;
  await tools.get('manage_session').execute({ session: 'a' });
  await tools.get('manage_session').execute({ session: 'b' });
});

afterEach(() => {
  dispose?.();
  mock.restoreAll();
  syncBuiltinESMExports();
  rmSync(dir, { recursive: true, force: true });
});

function tasks(): any[] {
  const path = join(dir, 'tasks.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
}

async function post(path: string, body: unknown): Promise<number> {
  const req = Object.assign(new EventEmitter(), {
    url: `/jarvis/${path}`, method: 'POST', socket: { remoteAddress: '127.0.0.1' },
    headers: { authorization: `Bearer ${JSON.parse(readFileSync(join(dir, 'runtime.json'), 'utf8')).token}` },
  });
  let code = 0;
  const res = { writeHead: (status: number) => { code = status; }, end() {} };
  const pending = handler(req, res);
  req.emit('data', Buffer.from(JSON.stringify(body)));
  req.emit('end');
  await pending;
  return code;
}

describe('等价类', () => {
  it('面板原话在成功投递后与改写消息一起记账', async () => {
    assert.equal(await post('input', { session: 'a', text: '请修好测试' }), 200);
    assert.equal(tasks().length, 0);
    await tools.get('inject_to_session').execute({ session: 'a', message: '修复失败测试并验证' });
    assert.equal(tasks()[0].request, '请修好测试');
    assert.equal(tasks()[0].message, '修复失败测试并验证');
    assert.equal(tasks()[0].status, 'open');
    assert.equal(workerMessages.length, 1);
  });

  it('无目标输入不影响工具投递的 request 回退', async () => {
    await post('input', { text: '你好' });
    await tools.get('inject_to_session').execute({ session: 'a', message: '实现任务' });
    assert.equal(tasks()[0].request, '实现任务');
  });

  it('release_session 和面板移出都终止对应任务', async () => {
    for (const session of ['a', 'b']) {
      await tools.get('inject_to_session').execute({ session, message: '执行' });
    }
    await tools.get('release_session').execute({ session: 'a' });
    assert.deepEqual(tasks().map(t => t.status), ['dropped', 'open']);
    assert.equal(await post('managed', { session: 'b', managed: false }), 200);
    assert.deepEqual(tasks().map(t => t.status), ['dropped', 'dropped']);
  });
});

describe('边界值', () => {
  it('运行中会话的 steer 成功后也记账', async () => {
    workers.set('a', { status: 'running', steer: (msg: unknown) => workerMessages.push(msg) });
    await tools.get('inject_to_session').execute({ session: 'a', message: '补充指令' });
    assert.equal(workerMessages.length, 1);
    assert.equal(tasks()[0].message, '补充指令');
  });

  it('保留用户原话的首尾空白', async () => {
    await post('input', { session: 'a', text: '  原话\n' });
    await tools.get('inject_to_session').execute({ session: 'a', message: '改写' });
    assert.equal(tasks()[0].request, '  原话\n');
  });

  it('仅支持 inject 的输入和工作会话也能记录原话', async () => {
    delete jarvis.followup;
    jarvis.inject = (msg: unknown) => jarvisMessages.push(msg);
    workers.set('a', { inject: (msg: unknown) => workerMessages.push(msg) });
    assert.equal(await post('input', { session: 'a', text: '原话' }), 200);
    await tools.get('inject_to_session').execute({ session: 'a', message: '改写' });
    assert.equal(jarvisMessages.length, 1);
    assert.equal(workerMessages.length, 1);
    assert.equal(tasks()[0].request, '原话');
  });
});

describe('异常路径', () => {
  it('投递失败不生成任务，也不消费原话', async () => {
    await post('input', { session: 'a', text: '原话' });
    workers.set('a', {});
    await assert.rejects(tools.get('inject_to_session').execute({ session: 'a', message: '失败' }));
    assert.equal(tasks().length, 0);
    workers.set('a', { followup() { throw new Error('delivery failed'); } });
    await assert.rejects(tools.get('inject_to_session').execute({ session: 'a', message: '抛错' }));
    assert.equal(tasks().length, 0);
    workers.set('a', { followup() {} });
    await tools.get('inject_to_session').execute({ session: 'a', message: '重试' });
    assert.equal(tasks()[0].request, '原话');
  });

  it('空消息在投递前被拒绝', async () => {
    await assert.rejects(tools.get('inject_to_session').execute({ session: 'a', message: '  ' }));
    assert.equal(workerMessages.length, 0);
    assert.equal(tasks().length, 0);
  });

  it('被拒绝的面板输入不会残留原话', async () => {
    delete jarvis.followup;
    assert.equal(await post('input', { session: 'a', text: '不应保留' }), 500);
    jarvis.followup = () => { throw new Error('input failed'); };
    assert.equal(await post('input', { session: 'a', text: '也不应保留' }), 500);
    await tools.get('inject_to_session').execute({ session: 'a', message: '独立指令' });
    assert.equal(tasks()[0].request, '独立指令');
  });
});
