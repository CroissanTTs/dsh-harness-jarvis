import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { visibleWorkers, workspaceName } from '../src/sessions.ts';

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
