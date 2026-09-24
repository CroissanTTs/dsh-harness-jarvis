import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { needsRename } from '../src/title.ts';

describe('等价类', () => {
  it('完全相同的标题无需重命名', () => {
    assert.equal(needsRename('贾维斯', '贾维斯'), false);
  });
  it('其他标题需要重命名', () => {
    assert.equal(needsRename('Jarvis', '贾维斯'), true);
  });
});

describe('边界值', () => {
  it('空串、纯空白和前后空格不等同目标标题', () => {
    for (const current of ['', ' ', ' 贾维斯', '贾维斯 ', '\t贾维斯\n']) {
      assert.equal(needsRename(current, '贾维斯'), true);
    }
  });
  it('目标和当前标题都为空时仍按完全相同处理', () => {
    assert.equal(needsRename('', ''), false);
  });
});

describe('异常路径', () => {
  it('undefined 和其他非字符串值均需要重命名，不做隐式转换', () => {
    for (const current of [undefined, null, 0, true, {}, ['贾维斯'], { toString: () => '贾维斯' }]) {
      assert.equal(needsRename(current, '贾维斯'), true);
    }
  });
});
