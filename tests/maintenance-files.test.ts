import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupSpeechCache, RotatingLog } from '../src/maintenance-files.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jv-maintenance-')); });
afterEach(() => { chmodSync(dir, 0o700); rmSync(dir, { recursive: true, force: true }); });
const now = Date.now();
function oldFile(name: string): string {
  const path = join(dir, name);
  writeFileSync(path, name);
  utimesSync(path, new Date(now - 8 * 86_400_000), new Date(now - 8 * 86_400_000));
  return path;
}

describe('等价类', () => {
  it('第100次写入后超限日志覆盖归档，下次写入创建新日志', () => {
    const path = join(dir, 'nested', 'debug.log');
    const log = new RotatingLog(path);
    log.write('x'.repeat(1_048_577));
    writeFileSync(path + '.1', 'old archive');
    for (let i = 1; i < 99; i++) log.write('line\n');
    assert.equal(readFileSync(path + '.1', 'utf8'), 'old archive');
    log.write('hundred\n');
    assert.equal(existsSync(path), false);
    assert.ok(readFileSync(path + '.1', 'utf8').endsWith('hundred\n'));
    log.write('new\n');
    assert.equal(readFileSync(path, 'utf8'), 'new\n');
  });
  it('真实目录删除旧say缓存，保留欢迎语和新缓存', () => {
    const old = oldFile('say-old.mp3');
    const greet = oldFile('greet-old.mp3');
    writeFileSync(join(dir, 'say-new.mp3'), 'new');
    cleanupSpeechCache(dir, now);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(greet), true);
    assert.equal(existsSync(join(dir, 'say-new.mp3')), true);
  });
});

describe('边界值', () => {
  it('第100次总大小恰好1MB不轮转，下个100次检查才轮转', () => {
    const path = join(dir, 'debug.log');
    const log = new RotatingLog(path);
    log.write('x'.repeat(1_048_576));
    for (let i = 1; i < 100; i++) log.write('');
    assert.equal(existsSync(path + '.1'), false);
    log.write('x');
    for (let i = 101; i < 199; i++) log.write('');
    assert.equal(existsSync(path + '.1'), false);
    log.write('');
    assert.equal(existsSync(path + '.1'), true);
  });
});

describe('异常路径', () => {
  it('日志父路径是普通文件时写失败不抛出，恢复后继续写', () => {
    const parent = join(dir, 'parent');
    writeFileSync(parent, 'block');
    const log = new RotatingLog(join(parent, 'debug.log'));
    assert.doesNotThrow(() => log.write('lost'));
    rmSync(parent);
    log.write('ok');
    assert.equal(readFileSync(join(parent, 'debug.log'), 'utf8'), 'ok');
  });
  it('归档是非空目录时轮转失败保留当前日志，后续继续写', () => {
    const path = join(dir, 'debug.log');
    const log = new RotatingLog(path);
    mkdirSync(path + '.1');
    writeFileSync(join(path + '.1', 'block'), 'block');
    log.write('x'.repeat(1_048_577));
    for (let i = 1; i < 100; i++) assert.doesNotThrow(() => log.write('x'));
    log.write('still works');
    assert.ok(readFileSync(path, 'utf8').endsWith('still works'));
  });
  it('缓存目录缺失或是普通文件时不抛出', () => {
    assert.doesNotThrow(() => cleanupSpeechCache(join(dir, 'missing'), now));
    writeFileSync(join(dir, 'file'), 'file');
    assert.doesNotThrow(() => cleanupSpeechCache(join(dir, 'file'), now));
  });
  it('匹配名称的目录及符号链接不参与清理', () => {
    mkdirSync(join(dir, 'say-directory.mp3'));
    const target = oldFile('greet-target.mp3');
    symlinkSync(target, join(dir, 'say-link.mp3'));
    cleanupSpeechCache(dir, now);
    assert.equal(existsSync(join(dir, 'say-directory.mp3')), true);
    assert.equal(existsSync(join(dir, 'say-link.mp3')), true);
    assert.equal(existsSync(target), true);
  });
  it('真实文件系统拒绝删除时不抛出或影响其他功能', () => {
    const old = oldFile('say-old.mp3');
    chmodSync(dir, 0o500);
    try {
      assert.doesNotThrow(() => cleanupSpeechCache(dir, now));
      assert.equal(existsSync(old), true);
    } finally { chmodSync(dir, 0o700); }
  });
});
