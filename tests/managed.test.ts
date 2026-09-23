import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedSet } from '../src/managed.ts';

let dir = '';
let file = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jv-managed-')); file = join(dir, 'managed.json'); });
afterEach(() => { try { chmodSync(dir, 0o700); } catch {} rmSync(dir, { recursive: true, force: true }); });

// ── 等价类 ──────────────────────────────────────────────────────────────
describe('等价类', () => {
  it('交给贾维斯后写盘，重新加载仍在', () => {
    const set = new ManagedSet(file);
    assert.equal(set.add('s-1'), true);
    assert.equal(set.add('s-2'), true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), ['s-1', 's-2']);
    assert.deepEqual(new ManagedSet(file).list(), ['s-1', 's-2']);
  });

  it('移出后不再托管，文件同步更新', () => {
    const set = new ManagedSet(file);
    set.add('s-1'); set.add('s-2');
    assert.equal(set.remove('s-1'), true);
    assert.equal(set.has('s-1'), false);
    assert.deepEqual(new ManagedSet(file).list(), ['s-2']);
  });

  it('兼容 {managed: [...]} 的旧格式', () => {
    writeFileSync(file, JSON.stringify({ managed: ['a', 'b'], monitoring: ['a'] }));
    assert.deepEqual([...new ManagedSet(file)], ['a', 'b']);
  });
});

// ── 边界值 ──────────────────────────────────────────────────────────────
describe('边界值', () => {
  it('文件不存在时是空集，也不会主动建文件', () => {
    const set = new ManagedSet(file);
    assert.deepEqual(set.list(), []);
    assert.equal(existsSync(file), false);
  });

  it('重复添加 / 移除不存在的会话不算变化，也不写盘', () => {
    const set = new ManagedSet(file);
    set.add('s');
    const before = readFileSync(file, 'utf8');
    rmSync(file);
    assert.equal(set.add('s'), false);
    assert.equal(set.remove('nope'), false);
    assert.equal(existsSync(file), false);
    assert.ok(before.includes('"s"'));
  });

  it('全部移出后文件是空数组', () => {
    const set = new ManagedSet(file);
    set.add('s'); set.remove('s');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), []);
  });

  it('父目录不存在时自动创建', () => {
    const nested = join(dir, 'a', 'b', 'managed.json');
    new ManagedSet(nested).add('s');
    assert.deepEqual(JSON.parse(readFileSync(nested, 'utf8')), ['s']);
  });
});

// ── 异常路径 ────────────────────────────────────────────────────────────
describe('异常路径', () => {
  it('文件损坏时按空集处理', () => {
    writeFileSync(file, '{not json');
    assert.deepEqual(new ManagedSet(file).list(), []);
  });

  it('数组里的非字符串和空串被丢弃', () => {
    writeFileSync(file, JSON.stringify(['a', 42, '', null, 'b']));
    assert.deepEqual(new ManagedSet(file).list(), ['a', 'b']);
  });

  it('空 id 不能加入', () => {
    const set = new ManagedSet(file);
    assert.equal(set.add(''), false);
    assert.equal(existsSync(file), false);
  });

  it('写盘失败时报告错误，但本次运行里仍然生效', { skip: process.getuid?.() === 0 }, () => {
    const errors: unknown[] = [];
    const set = new ManagedSet(file, (e) => errors.push(e));
    chmodSync(dir, 0o500);
    assert.equal(set.add('s'), true);
    assert.equal(set.has('s'), true);
    assert.equal(errors.length, 1);
  });
});
