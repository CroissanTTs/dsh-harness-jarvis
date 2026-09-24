import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { apply, Config } from '../src/index.ts';
import { OutputCoordinator } from '../src/output.ts';

let dir: string;
let dispose: (() => void) | void;
let tools: Map<string, any>;
let workers: Map<string, any>;
let workerMessages: unknown[];
let jarvisMessages: unknown[];
let jarvis: any;
let handler: any;
let context: any;
let listeners: Map<string, ((...args: any[]) => unknown)[]>;
let llmRequests: any[];
let verdict: Record<string, string>;
let llmStream: (options: any) => AsyncIterable<any>;
let questions: any[];
let selected: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jv-tasks-wiring-'));
  tools = new Map();
  workerMessages = [];
  jarvisMessages = [];
  listeners = new Map();
  llmRequests = [];
  questions = [];
  selected = '继续';
  verdict = { verdict: 'satisfied', summary: '测试已修复' };
  llmStream = async function* () {
    yield { type: 'text-delta', text: JSON.stringify(verdict) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  jarvis = { followup: (msg: unknown) => jarvisMessages.push(msg) };
  workers = new Map(['a', 'b'].map(id => [id, {
    status: 'idle', followup: (msg: unknown) => workerMessages.push(msg),
    session: { deriveMessages: () => [
      { role: 'user', content: [{ type: 'text', text: '请修好测试' }] },
      { role: 'assistant', content: [{ type: 'text', text: '已修复测试并通过验证' }] },
    ] },
  }]));
  // Exercise plugin routes and tools without starting the native panel.
  mock.method(childProcess, 'spawn', () => Object.assign(new EventEmitter(), {
    unref() {}, kill() {}, killed: false,
  }));
  syncBuiltinESMExports();
  const services: Record<string, any> = {
    agents: workers,
    llm: { stream: (options: any) => { llmRequests.push(options); return llmStream(options); } },
    userQuestions: { ask: async (request: any) => {
      questions.push(request);
      return { answers: [{ selected: [selected] }] };
    } },
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
    provide(name: string, service: unknown) { services[name] = service; }, on(name: string, callback: (...args: any[]) => unknown) {
      listeners.set(name, [...(listeners.get(name) ?? []), callback]);
    },
    tools: { register: (tool: any) => tools.set(tool.name, tool) },
  };
  context = ctx;
  dispose = undefined;
  await startPlugin();
  jarvisMessages.length = 0;
  await tools.get('manage_session').execute({ session: 'a' });
  await tools.get('manage_session').execute({ session: 'b' });
});

async function startPlugin(overrides: Record<string, unknown> = {}): Promise<void> {
  dispose?.();
  listeners.clear();
  dispose = apply(context, {
    audioDir: dir, managedFile: join(dir, 'managed.json'),
    tasksFile: join(dir, 'tasks.json'), runtimeFile: join(dir, 'runtime.json'),
    ...overrides,
  });
  await Promise.resolve();
  await post('voice', { action: 'mute' });
}

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

function event(session: string, type: string, kind?: string): void {
  for (const listener of listeners.get('session/event') ?? []) {
    listener({ id: session }, { type, ...(kind ? { data: { reason: { kind } } } : {}) });
  }
}

async function settled(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(predicate(), 'expected asynchronous completion state to settle');
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
}

function delayedVerdict(): () => void {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  llmStream = async function* () {
    await pending;
    yield { type: 'text-delta', text: JSON.stringify(verdict) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  return release;
}

describe('等价类', () => {
  it('并发完成按真实会话交给协调器，失败立即播报', async () => {
    const announcements: any[] = [];
    mock.method(OutputCoordinator.prototype, 'announce', async (...args: any[]) => { announcements.push(args); });
    for (const session of ['a', 'b']) await tools.get('inject_to_session').execute({ session, message: '执行' });
    event('a', 'turn/end', 'completed');
    event('b', 'turn/end', 'completed');
    await settled(() => announcements.length === 2);
    assert.deepEqual(announcements.map(a => a[0]).sort(), ['a', 'b']);
    for (const [session, text, options] of announcements) {
      assert.equal(text, `${session}：测试已修复`);
      assert.equal(options.title, session);
      assert.equal(options.immediate, false);
    }
    await tools.get('inject_to_session').execute({ session: 'b', message: '重试' });
    event('b', 'turn/end', 'error');
    await settled(() => announcements.length === 3);
    assert.equal(announcements[2][0], 'b');
    assert.equal(announcements[2][2].immediate, true);
  });

  it('ask_user 串行等待，原样传递 agent/signal 和续做 session/task', async () => {
    let release!: (value: any) => void;
    context.get('userQuestions').ask = async (request: any) => {
      questions.push(request);
      if (questions.length === 1) return new Promise(resolve => { release = resolve; });
      return { answers: [{ selected: ['不用了'] }] };
    };
    verdict = { verdict: 'unsatisfied', summary: '未完成', missing: '补测试' };
    await tools.get('inject_to_session').execute({ session: 'b', message: '执行' });
    event('b', 'turn/end', 'completed');
    await settled(() => tasks()[0]?.status === 'unsatisfied');
    const task = tasks()[0].id;
    const first = tools.get('ask_user').execute({ question: '第一个' });
    const agent = { id: 'caller' };
    const signal = new AbortController().signal;
    const second = tools.get('ask_user').execute({ question: '继续吗', session: 'b', task }, { agent, signal });
    await flush();
    assert.equal(questions.length, 1);
    release({ answers: [{ selected: ['好'] }] });
    await Promise.all([first, second]);
    assert.equal(questions.length, 2);
    assert.equal(questions[1].agent, agent);
    assert.equal(questions[1].signal, signal);
    assert.equal(tasks().find(t => t.id === task).status, 'dropped');
  });

  it('提供 claimsTurnEnd 并随台账从 open、judging 到 done 变化', async () => {
    const service = context.get('jarvis');
    assert.equal(service.claimsTurnEnd('a'), false);
    await tools.get('inject_to_session').execute({ session: 'a', message: '执行任务' });
    assert.equal(service.claimsTurnEnd('a'), true);
    event('a', 'turn/end', 'completed');
    assert.equal(tasks()[0].status, 'judging');
    assert.equal(service.claimsTurnEnd('a'), true);
    await settled(() => tasks()[0]?.status === 'done');
    assert.equal(service.claimsTurnEnd('a'), false);
  });
  it('completed 使用默认模型完成裁决并记账，不向 Jarvis 回注 satisfied', async () => {
    const defaults = Config({}) as any;
    assert.equal(defaults.judgeEnabled, true);
    assert.equal(defaults.judgeTimeoutMs, 20_000);
    assert.equal(defaults.maxContinueRounds, 2);
    assert.equal(defaults.judgeProvider, '');
    assert.equal(defaults.judgeModel, '');
    await tools.get('inject_to_session').execute({ session: 'a', message: '修复测试' });
    event('a', 'turn/end', 'completed');
    await settled(() => tasks()[0]?.status === 'done');
    assert.equal(tasks()[0].lastVerdict.verdict, 'satisfied');
    assert.equal(tasks()[0].lastVerdict.summary, '测试已修复');
    assert.equal(typeof tasks()[0].lastVerdict.at, 'number');
    assert.equal(llmRequests.length, 1);
    assert.equal(llmRequests[0].provider, defaults.provider);
    assert.equal(llmRequests[0].model, defaults.model);
    assert.equal(llmRequests[0].purpose, 'jarvis-judge');
    assert.match(llmRequests[0].messages[0].content[0].text, /已修复测试并通过验证/);
    assert.equal(jarvisMessages.length, 0);
  });

  it('unsatisfied 回注明确任务，用户同意后续投递保留 id 与原话并增加 rounds', async () => {
    verdict = { verdict: 'unsatisfied', summary: '还缺验证', missing: '补齐回归测试' };
    await post('input', { session: 'a', text: '请修好全部测试' });
    await tools.get('inject_to_session').execute({ session: 'a', message: '修复测试' });
    const original = tasks()[0];
    jarvisMessages.length = 0;
    event('a', 'turn/end', 'completed');
    await settled(() => tasks()[0]?.status === 'unsatisfied');
    assert.equal(jarvisMessages.length, 1);
    const notice = jarvisMessages[0] as any;
    assert.equal(notice.role, 'user');
    assert.equal(notice.source.kind, 'plugin');
    assert.ok(notice.content[0].text.includes(original.id));
    assert.match(notice.content[0].text, /补齐回归测试/);
    const answer = await tools.get('ask_user').execute({
      question: '继续补齐测试吗？', choices: ['继续', '不用了'], session: 'a', task: original.id,
    });
    assert.match(answer.text, /继续/);
    assert.equal(questions.length, 1);
    assert.deepEqual(questions[0].questions[0].options, [{ label: '继续' }, { label: '不用了' }]);
    await tools.get('inject_to_session').execute({ session: 'a', message: '补齐回归测试并验证' });
    assert.equal(tasks().length, 1);
    assert.equal(tasks()[0].id, original.id);
    assert.equal(tasks()[0].request, original.request);
    assert.equal(tasks()[0].message, '补齐回归测试并验证');
    assert.equal(tasks()[0].rounds, 1);
    assert.equal(tasks()[0].status, 'open');
  });

  it('用户选择不用了后结束当前未满足任务', async () => {
    verdict = { verdict: 'unsatisfied', summary: '尚未完成', missing: '补齐测试' };
    selected = '不用了';
    await tools.get('inject_to_session').execute({ session: 'a', message: '完成测试' });
    event('a', 'turn/end', 'completed');
    await settled(() => tasks()[0]?.status === 'unsatisfied');
    await tools.get('ask_user').execute({
      question: '是否继续？', choices: ['继续', '不用了'], session: 'a', task: tasks()[0].id,
    });
    assert.equal(tasks()[0].status, 'dropped');
    assert.equal(workerMessages.length, 1);
  });

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
  it('达到续轮上限的提醒不合并成完成', async () => {
    await startPlugin({ maxContinueRounds: 0 });
    const announcements: any[] = [];
    mock.method(OutputCoordinator.prototype, 'announce', async (...args: any[]) => { announcements.push(args); });
    verdict = { verdict: 'unsatisfied', summary: '未完成', missing: '补测试' };
    await tools.get('inject_to_session').execute({ session: 'a', message: '执行' });
    event('a', 'turn/end', 'completed');
    await settled(() => announcements.length === 1);
    assert.match(announcements[0][1], /还没做完/);
    assert.equal(announcements[0][2].immediate, true);
  });

  it('排队续做问题在移出后丢弃，重新托管也不弹旧问题', async () => {
    let release!: (value: any) => void;
    context.get('userQuestions').ask = async (request: any) => {
      questions.push(request);
      if (questions.length === 1) return new Promise(resolve => { release = resolve; });
      return { answers: [] };
    };
    verdict = { verdict: 'unsatisfied', summary: '未完成', missing: '补测试' };
    await tools.get('inject_to_session').execute({ session: 'a', message: '执行' });
    event('a', 'turn/end', 'completed');
    await settled(() => tasks()[0]?.status === 'unsatisfied');
    const first = tools.get('ask_user').execute({ question: '第一问' });
    const second = tools.get('ask_user').execute({ question: '继续吗', session: 'a', task: tasks()[0].id });
    await tools.get('release_session').execute({ session: 'a' });
    await tools.get('manage_session').execute({ session: 'a' });
    release({ answers: [] });
    await Promise.all([first, second]);
    assert.equal(questions.length, 1);
  });

  it('判断关闭时不接管，重新启用后等待续轮仍接管，移出即放弃', async () => {
    await tools.get('inject_to_session').execute({ session: 'a', message: '任务' });
    await startPlugin({ judgeEnabled: false });
    assert.equal(context.get('jarvis').claimsTurnEnd('a'), false);
    await startPlugin({ judgeEnabled: true });
    verdict = { verdict: 'unsatisfied', summary: '尚未完成', missing: '补测试' };
    event('a', 'turn/end', 'completed');
    await settled(() => tasks()[0]?.status === 'unsatisfied');
    assert.equal(context.get('jarvis').claimsTurnEnd('a'), true);
    await tools.get('release_session').execute({ session: 'a' });
    assert.equal(context.get('jarvis').claimsTurnEnd('a'), false);
  });
  it('未托管或没有任务时不裁决，turn-stopping 不注册裁决监听', async () => {
    assert.equal(listeners.has('agent/turn-stopping'), false);
    event('a', 'turn/end', 'completed');
    await tools.get('inject_to_session').execute({ session: 'b', message: '完成测试' });
    await tools.get('release_session').execute({ session: 'b' });
    event('b', 'turn/end', 'completed');
    event('unknown', 'turn/end', 'completed');
    await flush();
    assert.equal(llmRequests.length, 0);
    assert.equal(jarvisMessages.length, 0);
  });

  it('独立配置 judge provider/model 覆盖 Jarvis 默认模型', async () => {
    await startPlugin({ provider: 'commander', model: 'main', judgeProvider: 'reviewer', judgeModel: 'small' });
    jarvisMessages.length = 0;
    await tools.get('inject_to_session').execute({ session: 'a', message: '完成测试' });
    event('a', 'turn/end', 'completed');
    await settled(() => tasks()[0]?.status === 'done');
    assert.equal(llmRequests[0].provider, 'reviewer');
    assert.equal(llmRequests[0].model, 'small');
  });

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
  it('排队期间任务被新任务替换，不向用户展示旧续做问题', async () => {
    let release!: (value: any) => void;
    context.get('userQuestions').ask = async (request: any) => {
      questions.push(request);
      if (questions.length === 1) return new Promise(resolve => { release = resolve; });
      return { answers: [{ selected: ['继续'] }] };
    };
    verdict = { verdict: 'unsatisfied', summary: '未完成', missing: '补测试' };
    await tools.get('inject_to_session').execute({ session: 'a', message: '执行' });
    event('a', 'turn/end', 'completed');
    await settled(() => tasks()[0]?.status === 'unsatisfied');
    const first = tools.get('ask_user').execute({ question: '第一问' });
    const second = tools.get('ask_user').execute({ question: '旧问题', session: 'a', task: tasks()[0].id });
    const rejected = assert.rejects(second, /任务已变化/);
    event('a', 'turn/start');
    release({ answers: [] });
    await first;
    await rejected;
    assert.equal(questions.length, 1);
  });

  it('未知、空或非字符串会话 id 不接管且不抛错', () => {
    const service = context.get('jarvis');
    for (const id of ['unknown', '', ' ', undefined, null, 123]) {
      assert.equal(service.claimsTurnEnd(id), false);
    }
  });
  it('error 保留 open，aborted 结束为 dropped，均不调用模型', async () => {
    await tools.get('inject_to_session').execute({ session: 'a', message: '完成测试' });
    event('a', 'turn/end', 'error');
    await flush();
    assert.equal(tasks()[0].status, 'open');
    event('a', 'turn/end', 'aborted');
    await settled(() => tasks()[0]?.status === 'dropped');
    assert.equal(llmRequests.length, 0);
    assert.equal(jarvisMessages.length, 0);
  });

  it('裁决期间开始新轮次使旧结果失效，不回注续做通知', async () => {
    verdict = { verdict: 'unsatisfied', summary: '尚未完成', missing: '补齐测试' };
    const release = delayedVerdict();
    try {
      await tools.get('inject_to_session').execute({ session: 'a', message: '完成测试' });
      event('a', 'turn/end', 'completed');
      await settled(() => llmRequests.length === 1);
      assert.equal(tasks()[0].status, 'judging');
      event('a', 'turn/start');
      release();
      await flush();
      assert.equal(tasks()[0].status, 'open');
      assert.equal(tasks()[0].lastVerdict, undefined);
      assert.equal(jarvisMessages.length, 0);
      assert.equal(llmRequests[0].signal.aborted, true);
    } finally { release(); }
  });

  it('移出正在裁决的会话会终止任务并丢弃迟到结果', async () => {
    const release = delayedVerdict();
    try {
      await tools.get('inject_to_session').execute({ session: 'a', message: '完成测试' });
      event('a', 'turn/end', 'completed');
      await settled(() => llmRequests.length === 1);
      await tools.get('release_session').execute({ session: 'a' });
      release();
      await flush();
      assert.equal(tasks()[0].status, 'dropped');
      assert.equal(tasks()[0].lastVerdict, undefined);
      assert.equal(jarvisMessages.length, 0);
      assert.equal(llmRequests[0].signal.aborted, true);
    } finally { release(); }
  });

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
