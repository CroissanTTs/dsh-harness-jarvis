import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionRow } from '../src/session-state.ts';

const base = { id: 'a', title: 'hammer', status: 'idle', unread: true, managed: true, workspace: 'repo' };

describe('等价类', () => {
  it('三种未结状态输出任务标签数据并保留会话字段', () => {
    for (const status of ['open', 'judging', 'unsatisfied'] as const) {
      assert.deepEqual(sessionRow(base, { status, request: '原始需求' }), {
        ...base, task: { status, summary: '原始需求' },
      });
    }
    assert.equal('task' in base, false);
  });
  it('优先使用缺少项，且不泄露台账的其他字段', () => {
    const task = { status: 'unsatisfied' as const, request: '原始需求', message: '改写', id: 'private',
      lastVerdict: { verdict: 'unsatisfied' as const, summary: '裁决摘要', missing: '补齐测试', at: 1 } };
    assert.deepEqual(sessionRow(base, task).task, { status: 'unsatisfied', summary: '补齐测试' });
  });
  it('已完成、已丢弃及无任务时不输出task字段', () => {
    for (const status of ['done', 'dropped'] as const) {
      assert.deepEqual(sessionRow(base, { status, request: '已结束' }), base);
    }
    assert.deepEqual(sessionRow(base), base);
  });
});

describe('边界值', () => {
  it('请求原文29、30、31字，最多保留30个Unicode码点', () => {
    for (const length of [29, 30, 31]) {
      assert.equal(sessionRow(base, { status: 'open', request: '测'.repeat(length) }).task?.summary,
        '测'.repeat(Math.min(length, 30)));
    }
    assert.equal(sessionRow(base, { status: 'judging', request: '🙂'.repeat(31) }).task?.summary, '🙂'.repeat(30));
    assert.equal(sessionRow(base, { status: 'open', request: '  原话\n' }).task?.summary, '  原话\n');
  });
  it('缺少项不按30字截断；空缺少项回退原文，空摘要省略', () => {
    for (const missing of ['', '  ', '补'.repeat(40)]) {
      const row = sessionRow(base, { status: 'unsatisfied', request: '原文',
        lastVerdict: { verdict: 'unsatisfied', summary: '', missing, at: 1 } });
      assert.equal(row.task?.summary, missing.trim() ? missing : '原文');
    }
    assert.deepEqual(sessionRow(base, { status: 'open', request: '' }).task, { status: 'open' });
  });
});

describe('异常路径', () => {
  it('null、未知状态及错误类型任务不污染会话行', () => {
    for (const task of [null, 1, 'open', {}, { status: 'future' }, { status: 1 }]) {
      assert.deepEqual(sessionRow(base, task as any), base);
    }
  });
  it('错误类型missing回退请求，错误类型请求省略summary', () => {
    assert.deepEqual(sessionRow(base, { status: 'open', request: '需求', lastVerdict: { missing: 12 } } as any).task,
      { status: 'open', summary: '需求' });
    assert.deepEqual(sessionRow(base, { status: 'judging', request: {} } as any).task, { status: 'judging' });
  });
});
