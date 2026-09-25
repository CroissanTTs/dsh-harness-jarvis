import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { apply } from '../src/index.ts';

let dir: string;
let dispose: (() => void) | void;
let created: { sessionId: string; agentOptions: { provider: string; model: string } }[];

function start(services: Record<string, any>, config: Record<string, unknown>): void {
  const context: any = {
    get: (name: string) => services[name],
    inject: (names: string[], callback: (ctx: any) => void) => {
      if (names.every(name => name in services)) callback(context);
    },
    provide: () => {},
    on: () => {},
    logger: { warn: () => {} },
  };
  dispose = apply(context, {
    audioDir: dir, memoryRoot: dir, lockFile: join(dir, 'lock.json'),
    managedFile: join(dir, 'managed.json'), tasksFile: join(dir, 'tasks.json'),
    runtimeFile: join(dir, 'runtime.json'),
    ...config,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jv-agent-model-'));
  created = [];
  mock.method(childProcess, 'spawn', () => Object.assign(new EventEmitter(), {
    unref() {}, kill() {}, killed: false,
  }));
  syncBuiltinESMExports();
});

afterEach(() => {
  dispose?.();
  rmSync(dir, { recursive: true, force: true });
});

describe('agent model auto-resolution', () => {
  it('empty provider and model resolve to the first adapter and its first model', async () => {
    start({
      agentLoop: {
        createAgent: (_owner: unknown, opts: any) => {
          created.push({ sessionId: opts.sessionId, agentOptions: opts.agentOptions });
          return Promise.resolve({ agent: { followup: () => {} }, dispose: () => {} });
        },
        resume: () => Promise.reject(new Error('should not resume')),
      },
      llm: {
        adapters: new Map([['zhipu', {}], ['bailian', {}]]),
        listModels: (provider: string) => provider === 'zhipu' ? [{ id: 'glm-9' }, { id: 'glm-9-air' }] : [],
      },
    }, {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(created.length, 1);
    assert.equal(created[0].agentOptions.provider, 'zhipu');
    assert.equal(created[0].agentOptions.model, 'glm-9');
  });

  it('explicit provider and model are kept as-is', async () => {
    start({
      agentLoop: {
        createAgent: (_owner: unknown, opts: any) => {
          created.push({ sessionId: opts.sessionId, agentOptions: opts.agentOptions });
          return Promise.resolve({ agent: { followup: () => {} }, dispose: () => {} });
        },
        resume: () => Promise.reject(new Error('should not resume')),
      },
      llm: {
        adapters: new Map([['zhipu', {}]]),
        listModels: () => [{ id: 'glm-9' }],
      },
    }, { provider: 'openai', model: 'gpt-x' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(created.length, 1);
    assert.equal(created[0].agentOptions.provider, 'openai');
    assert.equal(created[0].agentOptions.model, 'gpt-x');
  });

  it('model alone auto-fills from the explicit provider', async () => {
    start({
      agentLoop: {
        createAgent: (_owner: unknown, opts: any) => {
          created.push({ sessionId: opts.sessionId, agentOptions: opts.agentOptions });
          return Promise.resolve({ agent: { followup: () => {} }, dispose: () => {} });
        },
        resume: () => Promise.reject(new Error('should not resume')),
      },
      llm: {
        adapters: new Map([['zhipu', {}]]),
        listModels: (provider: string) => provider === 'bailian' ? [{ id: 'qwen-max' }] : [],
      },
    }, { provider: 'bailian' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(created.length, 1);
    assert.equal(created[0].agentOptions.provider, 'bailian');
    assert.equal(created[0].agentOptions.model, 'qwen-max');
  });
});
