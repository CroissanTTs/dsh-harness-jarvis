import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from '../src/index.ts';
import { MemoryStore, parseMemory } from '../src/memory/store.ts';

let root: string, store: MemoryStore, dispose: (() => void) | void;
let tools: Map<string, any>, sections: Map<string, any>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jv-memory-wiring-')); tools = new Map(); sections = new Map();
  const services: Record<string, any> = {
    systemPrompt: { section: (section: any) => sections.set(section.name, section) },
    agentLoop: { createAgent: async (_owner: unknown, options: any) => { options.setup(ctx); return { agent: { followup() {} } }; } },
  };
  const ctx: any = {
    get: (name: string) => services[name], on() {}, provide() {},
    inject: (names: string[], callback: any) => { if (names.every(name => name in services)) callback(ctx); },
    tools: { register: (tool: any) => tools.set(tool.name, tool) },
  };
  dispose = apply(ctx, { audioDir: root, memoryRoot: root, lockFile: join(root, 'lock.json'),
    approvalsDir: join(root, 'memory', 'approvals'), managedFile: join(root, 'managed.json'), tasksFile: join(root, 'tasks.json') });
  await Promise.resolve();
  store = new MemoryStore({ rootDir: root });
});
afterEach(async () => { dispose?.(); await store.ready(); await rm(root, { recursive: true, force: true }); });

describe('等价类', () => {
  it('真实注册remember/recall，使用现有textOutput且可通过配置目录读写', async () => {
    const remember = tools.get('remember'), recall = tools.get('recall');
    assert.ok(remember); assert.ok(recall);
    const result = await remember.execute({ content: '用中文回复。详情不回传。', tag: '偏好', session: 'worker' });
    assert.deepEqual(result, { text: '记住了' });
    assert.deepEqual(remember.output.render({}, result), [{ type: 'text', text: '记住了' }]);
    assert.deepEqual(remember.output.schema, tools.get('say_to_user').output.schema);
    assert.deepEqual(recall.output.schema, remember.output.schema);
    const found = await recall.execute({ query: '中文', session: 'worker' });
    assert.match(found.text, /\[偏好\] 用中文回复。/); assert.doesNotMatch(found.text, /详情不回传/);
    const [file] = await store.listLong('worker');
    assert.equal(parseMemory((await store.readLong('worker', file))!)?.detail, '详情不回传。');
  });
  it('人设明确什么时候remember与recall', () => {
    const text = sections.get('jarvis:persona').text();
    assert.match(text, /用户说.*记住.*remember/); assert.match(text, /约定或决定.*recall/);
  });
});
describe('边界值', () => {
  it('limit=0和空库经工具返回text对象', async () => {
    assert.deepEqual(await tools.get('recall').execute({ query: '不存在' }), { text: '没有找到相关记忆' });
    await tools.get('remember').execute({ content: 'test' });
    assert.deepEqual(await tools.get('recall').execute({ query: 'test', limit: 0 }), { text: '没有找到相关记忆' });
  });
});
describe('异常路径', () => {
  it('非法参数从工具抛出，不返回成功', async () => {
    await assert.rejects(tools.get('remember').execute({ content: '   ' }));
    await assert.rejects(tools.get('recall').execute({ query: '' }));
  });
  it('配置目录损坏时写失败传递给宿主', async () => {
    await mkdir(join(root, 'memory')); await writeFile(join(root, 'memory', 'general'), 'blocked');
    await assert.rejects(tools.get('remember').execute({ content: 'test' }));
  });
});
