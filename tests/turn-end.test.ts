import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { claimsTurnEnd } from '../src/turn-end.ts';

describe('等价类', () => {
  it('判断启用时接管托管会话的所有未结任务', () => {
    for (const status of ['open', 'judging', 'unsatisfied'] as const) {
      assert.equal(claimsTurnEnd({ managed: true, task: { status }, judgeEnabled: true }), true);
    }
  });

  it('未托管或没有任务时由 voice-mini 照常播报', () => {
    assert.equal(claimsTurnEnd({ managed: false, task: { status: 'open' }, judgeEnabled: true }), false);
    assert.equal(claimsTurnEnd({ managed: true, judgeEnabled: true }), false);
  });
});

describe('边界值', () => {
  it('关闭判断后不接管，即使任务正在判断或等待续做', () => {
    for (const status of ['open', 'judging', 'unsatisfied'] as const) {
      assert.equal(claimsTurnEnd({ managed: true, task: { status }, judgeEnabled: false }), false);
    }
  });

  it('已完成与已丢弃任务不接管后续轮末播报', () => {
    for (const status of ['done', 'dropped'] as const) {
      assert.equal(claimsTurnEnd({ managed: true, task: { status }, judgeEnabled: true }), false);
    }
  });
});

describe('异常路径', () => {
  it('未知任务状态、空任务以及非布尔开关均不声明接管', () => {
    for (const task of [null, {}, { status: '' }, { status: 'unknown' }]) {
      assert.equal(claimsTurnEnd({ managed: true, task: task as any, judgeEnabled: true }), false);
    }
    for (const invalid of [undefined, null, 1, 'true']) {
      assert.equal(claimsTurnEnd({ managed: invalid as any, task: { status: 'open' }, judgeEnabled: true }), false);
      assert.equal(claimsTurnEnd({ managed: true, task: { status: 'open' }, judgeEnabled: invalid as any }), false);
    }
  });
});
