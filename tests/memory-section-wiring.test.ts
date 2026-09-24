import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderPrompt, type PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
import { apply } from '../src/index.ts';
import { MemoryStore, renderMemory, type LongEntry } from '../src/memory/store.ts';
let root: string, store: MemoryStore, dispose: (() => void) | void;
let sections: Map<string, any>, hooks: Map<string, any>, globalHooks: Map<string, any>, tools: Map<string, any>;
const entry = (key: string): LongEntry => ({ id: 'note', tag: 'note', source: 'remember', key, created: '2026-09-24T10:00:00Z' });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jv-section-wiring-')); store = new MemoryStore({ rootDir: root });
  sections = new Map(); hooks = new Map(); globalHooks = new Map(); tools = new Map();
});
afterEach(async () => { dispose?.(); mock.restoreAll(); await store.ready(); await rm(root, { recursive: true, force: true }); });
function start() {
  const sp = { section: (section: any) => sections.set(section.name, section) };
  const agent: any = { get: (name: string) => name === 'systemPrompt' ? sp : undefined,
    inject: (names: string[], callback: any) => { if (names[0] === 'systemPrompt') callback(agent); },
    on: (name: string, callback: any) => hooks.set(name, callback), tools: { register: (tool: any) => tools.set(tool.name, tool) } };
  const loop = { createAgent: async (_: unknown, options: any) => { options.setup(agent); return { agent: { followup() {} } }; } };
  const ctx: any = { get: (name: string) => name === 'agentLoop' ? loop : undefined,
    inject: (names: string[], callback: any) => { if (names[0] === 'agentLoop') callback(ctx); },
    on: (name: string, callback: any) => globalHooks.set(name, callback), provide() {} };
  dispose = apply(ctx, { memoryRoot: root, audioDir: root, lockFile: join(root, 'lock.json'), approvalsDir: join(root, 'memory', 'approvals'),
    managedFile: join(root, 'managed.json'), tasksFile: join(root, 'tasks.json') });
}
async function assemble(variables: Record<string, string> = {}, downstream?: (assembly: PromptAssembly) => void): Promise<PromptAssembly> {
  // Real host order: evaluate synchronous providers, then run the async cooperative waterfall.
  const assembly: PromptAssembly = { sections: [...sections.values()].sort((a,b) => a.order-b.order).map(s => ({ name: s.name, text: s.text() })),
    contexts: [], tools: [], variables };
  const hook = hooks.get('system-prompt/assemble');
  return hook ? hook(assembly, {}, async () => { downstream?.(assembly); return assembly; }) : assembly;
}
const memory = (assembly: PromptAssembly) => assembly.sections.find(s => s.name === 'jarvis:memory')!;

describe('等价类', () => {
  it('只在Jarvis agent作用域注册order60，首次组装即含已存记忆，保留persona', async () => {
    await mkdir(join(root, 'memory', 'general'), { recursive: true });
    await writeFile(join(root, 'memory', 'general', 'note.html'), renderMemory(entry('用中文回复')));
    start();
    assert.equal(sections.get('jarvis:memory')?.order, 60);
    assert.equal(globalHooks.has('system-prompt/assemble'), false);
    let reached = false;
    const result = await assemble({}, assembly => { reached = true; assert.match(memory(assembly).text, /用中文回复/); });
    assert.ok(reached); assert.match(renderPrompt(result), /你是贾维斯/);
    assert.match(memory(result).text, /用中文回复/);
  });
  it('remember后下一次组装刷新，其他会话记忆不进入section', async () => {
    start(); assert.equal(memory(await assemble()).text, '');
    await tools.get('remember').execute({ content: '通用约定。SECRET_DETAIL' });
    await tools.get('remember').execute({ content: 'PRIVATE', session: 'worker' });
    const text = memory(await assemble()).text;
    assert.match(text, /通用约定/); assert.doesNotMatch(text, /PRIVATE|SECRET_DETAIL/);
    assert.strictEqual(sections.get('jarvis:memory').text(), text);
  });
  it('version未变时不同组装上下文复用文本且不读盘', async () => {
    await store.writeLong('general', entry('固定内容')); start();
    const text = memory(await assemble({ date: 'one' })).text;
    const read = mock.method(MemoryStore.prototype, 'snapshotLong', () => { throw Error('no reads'); });
    assert.strictEqual(memory(await assemble({ date: 'two' })).text, text);
    assert.equal(read.mock.callCount(), 0);
  });
});
describe('边界值', () => {
  it('空库section为空，宿主render不会显示长期记忆标题', async () => {
    start(); assert.equal(memory(await assemble()).text, '');
    assert.doesNotMatch(renderPrompt(await assemble()), /长期记忆/);
  });
  it('删除最后一条后section恢复空串', async () => {
    await store.writeLong('general', entry('one')); start(); await assemble();
    await store.removeLong('general', 'note.html');
    assert.equal(memory(await assemble()).text, '');
  });
});
describe('异常路径', () => {
  it('key含模板占位符时保持原文，不抛错或随宿主变量变化', async () => {
    await store.writeLong('general', entry('使用 {{unknown}} 和 {{date}}，甚至 {{ malformed }}')); start();
    const first = renderPrompt(await assemble({ date: 'one' }));
    assert.match(first, /\{\{unknown\}\}/); assert.match(first, /\{\{date\}\}/);
    assert.equal(renderPrompt(await assemble({ date: 'two' })), first);
  });
  it('读失败不阻断prompt，保留persona并在后续恢复', async () => {
    start();
    const read = mock.method(MemoryStore.prototype, 'snapshotLong', async () => { throw Error('disk'); });
    assert.match(renderPrompt(await assemble()), /你是贾维斯/);
    assert.equal(memory(await assemble()).text, '');
    read.mock.restore();
    await store.writeLong('general', entry('recovered'));
    assert.match(memory(await assemble()).text, /recovered/);
  });
});
