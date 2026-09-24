import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.ts';

let dir: string;
let dispose: (() => void) | void;
let now: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jv-maintenance-wiring-'));
  now = Date.now();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  mock.timers.reset();
  rmSync(dir, { recursive: true, force: true });
});
function start(audioDir = dir): void {
  dispose = apply({ inject() {}, get() {}, on() {}, provide() {} } as any, {
    memoryRoot: dir, audioDir, managedFile: join(dir, 'managed.json'), tasksFile: join(dir, 'tasks.json'),
    lockFile: join(dir, 'lock.json'),
  });
}
function oldFile(): string {
  const path = join(dir, 'say-old.mp3');
  writeFileSync(path, 'old');
  utimesSync(path, new Date(now - 8 * 86_400_000), new Date(now - 8 * 86_400_000));
  return path;
}

describe('等价类', () => {
  it('插件启动后清理缓存', () => {
    const path = oldFile();
    start();
    mock.timers.tick(30_000);
    assert.equal(existsSync(path), false);
  });
});
describe('边界值', () => {
  it('29999毫秒不清理，30000毫秒开始，且只运行一次', () => {
    const path = oldFile();
    start();
    mock.timers.tick(29_999);
    assert.equal(existsSync(path), true);
    mock.timers.tick(1);
    assert.equal(existsSync(path), false);
    oldFile();
    mock.timers.tick(60_000);
    assert.equal(existsSync(path), true);
  });
  it('卸载会撤销尚未运行的清理', () => {
    const path = oldFile();
    start();
    dispose?.();
    dispose = undefined;
    mock.timers.tick(30_000);
    assert.equal(existsSync(path), true);
  });
});
describe('异常路径', () => {
  it('audioDir为普通文件，日志和延迟清理失败均不影响插件启动卸载', () => {
    const path = join(dir, 'blocked');
    writeFileSync(path, 'file');
    assert.doesNotThrow(() => start(path));
    assert.equal(typeof dispose, 'function');
    assert.doesNotThrow(() => mock.timers.tick(30_000));
    assert.doesNotThrow(() => dispose?.());
  });
});
