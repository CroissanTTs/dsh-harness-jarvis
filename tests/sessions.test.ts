import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deliver, visibleWorkers, workspaceName } from '../src/sessions.ts';

/** An agent that records which delivery method was used. */
function agent(status: string, methods: string[] = ['followup', 'steer', 'inject']) {
  const calls: string[] = [];
  const a: Record<string, unknown> = { status, calls };
  for (const m of methods) a[m] = function (this: typeof a, msg: unknown) { calls.push(`${m}:${String(msg)}`); assert.equal(this, a); };
  return a as { calls: string[] } & Record<string, unknown>;
}

describe('投递唤醒 deliver', () => {
  it('等价类：空闲会话开新一轮，运行中的插到下一步', () => {
    const idle = agent('idle');
    assert.equal(deliver(idle, 'hi'), 'followup');
    assert.deepEqual(idle.calls, ['followup:hi']);
    const busy = agent('running');
    assert.equal(deliver(busy, 'hi'), 'steer');
    assert.deepEqual(busy.calls, ['steer:hi']);
  });

  it('边界值：状态未知按空闲处理；缺首选方法时换另一种唤醒方式', () => {
    assert.equal(deliver(agent('maintenance'), 'x'), 'followup');
    assert.equal(deliver(agent('running', ['followup', 'inject']), 'x'), 'followup');
    assert.equal(deliver(agent('idle', ['steer']), 'x'), 'steer');
  });

  it('异常路径：只能 inject 时退回 inject；什么都没有返回 null', () => {
    assert.equal(deliver(agent('idle', ['inject']), 'x'), 'inject');
    assert.equal(deliver(agent('idle', []), 'x'), null);
    assert.equal(deliver(null, 'x'), null);
    assert.equal(deliver({ followup: 'not a function' }, 'x'), null);
  });
});

// ── 等价类 ──────────────────────────────────────────────────────────────
describe('等价类', () => {
  it('去掉贾维斯自己和已归档的会话，其余保持注册表顺序', () => {
    assert.deepEqual(
      visibleWorkers(['a', 'jarvis', 'b', 'old', 'c'], ['jarvis', 'old']),
      ['a', 'b', 'c'],
    );
  });

  it('没有需要排除的会话时原样返回', () => {
    assert.deepEqual(visibleWorkers(['a', 'b'], []), ['a', 'b']);
  });

  it('工作区名取目录最后一段', () => {
    assert.equal(workspaceName('/Users/zane/Vibe coding/dsh-plugin-discovery'), 'dsh-plugin-discovery');
    assert.equal(workspaceName('C:\\work\\quant'), 'quant');
  });
});

// ── 边界值 ──────────────────────────────────────────────────────────────
describe('边界值', () => {
  it('全部被归档时列表为空', () => {
    assert.deepEqual(visibleWorkers(['a', 'b'], ['a', 'b']), []);
  });

  it('空注册表返回空列表', () => {
    assert.deepEqual(visibleWorkers([], ['a']), []);
  });

  it('目录末尾的斜杠被忽略；根目录没有文件夹名', () => {
    assert.equal(workspaceName('/Users/zane/proj/'), 'proj');
    assert.equal(workspaceName('/'), undefined);
    assert.equal(workspaceName(''), undefined);
  });
});

// ── 异常路径 ────────────────────────────────────────────────────────────
describe('异常路径', () => {
  it('重复 id 只保留第一次出现', () => {
    assert.deepEqual(visibleWorkers(['a', 'b', 'a'], []), ['a', 'b']);
  });

  it('非字符串或空的 id 被丢弃，排除集合里的脏数据被忽略', () => {
    assert.deepEqual(visibleWorkers(['a', '', 42, null, 'b'], [undefined, 7, 'b']), ['a']);
  });

  it('cwd 不是字符串时没有工作区名', () => {
    for (const bad of [undefined, null, 42, {}]) assert.equal(workspaceName(bad), undefined);
  });
});
