import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PanelSupervisor } from '../src/panel-supervisor.ts';

function fixture() {
  let now = 0;
  const supervisor = new PanelSupervisor(() => now);
  supervisor.markStarted();
  return { supervisor, at: (value: number) => { now = value; } };
}

describe('等价类', () => {
  it('正常退出（手动退出或单实例保护）保持关闭', () => {
    assert.deepEqual(fixture().supervisor.onExit(0, null), { action: 'stay-down', reason: 'clean-exit' });
  });
  for (const [code, signal] of [[1, null], [127, null], [null, 'SIGKILL'], [null, 'SIGTERM']] as const) {
    it(`异常退出 ${code}/${signal} 安排首次重启`, () => {
      assert.deepEqual(fixture().supervisor.onExit(code, signal), { action: 'respawn', delayMs: 1000 });
    });
  }
  it('连续崩溃依次退避 1、5、30 秒', () => {
    const { supervisor } = fixture();
    for (const delayMs of [1000, 5000, 30000]) {
      assert.deepEqual(supervisor.onExit(1, null), { action: 'respawn', delayMs });
      supervisor.markStarted();
    }
  });
});

describe('边界值', () => {
  it('窗口内第三次仍重启，第四次停止且仅首次给出通知原因', () => {
    const { supervisor } = fixture();
    for (let i = 0; i < 3; i++) { supervisor.onExit(1, null); supervisor.markStarted(); }
    assert.deepEqual(supervisor.onExit(1, null), { action: 'stay-down', reason: 'crash-limit' });
    assert.deepEqual(supervisor.onExit(1, null), { action: 'stay-down', reason: 'stopped' });
  });
  for (const runtime of [599999, 600000, 600001]) {
    it(`运行 ${runtime} 毫秒后过期崩溃记录清零`, () => {
      const { supervisor, at } = fixture();
      at(100); supervisor.onExit(1, null);
      at(1100); supervisor.markStarted();
      at(1100 + runtime);
      assert.deepEqual(supervisor.onExit(1, null), { action: 'respawn', delayMs: 1000 });
    });
  }
  for (const [elapsed, action] of [[599999, 'stay-down'], [600000, 'respawn'], [600001, 'respawn']] as const) {
    it(`首个崩溃距今 ${elapsed} 毫秒时按滚动窗口决定上限`, () => {
      const { supervisor, at } = fixture();
      supervisor.onExit(1, null);
      at(1000); supervisor.markStarted(); supervisor.onExit(1, null);
      at(2000); supervisor.markStarted(); supervisor.onExit(1, null);
      at(3000); supervisor.markStarted();
      at(elapsed);
      assert.equal(supervisor.onExit(1, null).action, action);
    });
  }
  it('退避等待不计入稳定运行时间，滚动窗口内剩余崩溃仍计数', () => {
    const { supervisor, at } = fixture();
    supervisor.onExit(1, null);
    at(1000); supervisor.markStarted(); supervisor.onExit(1, null);
    at(6000); supervisor.markStarted(); supervisor.onExit(1, null);
    at(36000); supervisor.markStarted();
    at(605999); // 569999 ms of runtime; only the most recent crash remains.
    assert.deepEqual(supervisor.onExit(1, null), { action: 'respawn', delayMs: 5000 });
  });
});

describe('异常路径', () => {
  it('卸载后迟到的正常、崩溃与自身 SIGTERM 均被忽略', () => {
    const { supervisor } = fixture();
    supervisor.markDisposed(); supervisor.markDisposed(); supervisor.markStarted();
    for (const [code, signal] of [[0, null], [1, null], [null, 'SIGTERM']] as const) {
      assert.deepEqual(supervisor.onExit(code, signal), { action: 'stay-down', reason: 'disposed' });
    }
  });
  it('未成功启动的进程也受崩溃上限约束', () => {
    const supervisor = new PanelSupervisor(() => 0);
    for (let i = 0; i < 3; i++) assert.equal(supervisor.onExit(-1, null).action, 'respawn');
    assert.deepEqual(supervisor.onExit(-1, null), { action: 'stay-down', reason: 'crash-limit' });
  });
});
