import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cacheVictims, shouldRotate } from '../src/maintenance.ts';

const day = 86_400_000;
const now = 20 * day;
const policy = { maxAgeDays: 7, keep: 100 };
const file = (name: string, age = 0) => ({ name, mtimeMs: now - age * day });

describe('等价类', () => {
  it('日志仅在超过上限时轮转', () => {
    assert.equal(shouldRotate(2_000_000, 1_048_576), true);
    assert.equal(shouldRotate(500_000, 1_048_576), false);
  });
  it('新旧缓存混合时删除过期文件，欢迎语保留', () => {
    assert.deepEqual(cacheVictims([file('say-old.mp3', 8), file('say-new.mp3', 1), file('greet-old.mp3', 10)], now, policy), ['say-old.mp3']);
  });
  it('先删除过期项，再按修改时间只保留最新缓存，不改变输入', () => {
    const files = [file('say-a.mp3', 1), file('say-b.mp3', 2), file('say-c.mp3', 3), file('say-old.mp3', 8)];
    const original = structuredClone(files);
    assert.deepEqual(new Set(cacheVictims(files, now, { ...policy, keep: 2 })), new Set(['say-c.mp3', 'say-old.mp3']));
    assert.deepEqual(files, original);
  });
});

describe('边界值', () => {
  it('日志恰好1MB保留，多1字节轮转', () => {
    assert.equal(shouldRotate(1_048_576, 1_048_576), false);
    assert.equal(shouldRotate(1_048_577, 1_048_576), true);
    assert.equal(shouldRotate(0, 1_048_576), false);
  });
  it('缓存恰好7天保留，多1毫秒删除', () => {
    assert.deepEqual(cacheVictims([file('say-boundary.mp3', 7), { name: 'say-old.mp3', mtimeMs: now - 7 * day - 1 }], now, policy), ['say-old.mp3']);
  });
  it('恰好100个不删，101个删除最旧的', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({ name: `say-${i}.mp3`, mtimeMs: now - i }));
    assert.deepEqual(cacheVictims(files, now, policy), []);
    assert.deepEqual(cacheVictims([...files, { name: 'say-oldest.mp3', mtimeMs: now - 101 }], now, policy), ['say-oldest.mp3']);
  });
  it('修改时间相同时按文件名稳定排序，keep为0时删除所有有效缓存', () => {
    const files = [file('say-b.mp3'), file('say-a.mp3')];
    assert.deepEqual(cacheVictims(files, now, { ...policy, keep: 1 }), ['say-b.mp3']);
    assert.deepEqual(cacheVictims(files, now, { ...policy, keep: 0 }), ['say-a.mp3', 'say-b.mp3']);
  });
});

describe('异常路径', () => {
  it('空目录没有删除项', () => assert.deepEqual(cacheVictims([], now, policy), []));
  it('不匹配的文件名不参与清理或数量限制', () => {
    assert.deepEqual(cacheVictims(['greet-a.mp3', 'say-a.wav', 'say-.mp3', '../say-a.mp3', 'say-a/b.mp3'].map(name => file(name, 10)), now, { ...policy, keep: 0 }), []);
  });
  it('mtime缺失或非法时保留，未来时间有效', () => {
    assert.deepEqual(cacheVictims([{ name: 'say-missing.mp3' }, { name: 'say-nan.mp3', mtimeMs: NaN }, { name: 'say-inf.mp3', mtimeMs: Infinity }, file('say-future.mp3', -1)], now, policy), []);
  });
  it('非法大小或上限不会轮转', () => {
    for (const value of [NaN, Infinity, -1]) {
      assert.equal(shouldRotate(value, 100), false);
      assert.equal(shouldRotate(200, value), false);
    }
  });
  it('非法策略或当前时间不触发删除', () => {
    const files = [file('say-old.mp3', 10)];
    for (const options of [{ maxAgeDays: -1, keep: 100 }, { maxAgeDays: 7, keep: -1 }, { maxAgeDays: NaN, keep: 100 }, { maxAgeDays: 7, keep: 0.5 }]) {
      assert.deepEqual(cacheVictims(files, now, options), []);
    }
    assert.deepEqual(cacheVictims(files, NaN, policy), []);
  });
});
