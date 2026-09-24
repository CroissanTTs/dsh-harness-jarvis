import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LiveState, SPEECH_STALE_MS } from '../src/live-state.ts';

const start = (live: LiveState, text?: unknown, id = 'a') => live.speechSignal({ phase: 'start', id, source: 'session', sessionId: 'worker', text });
describe('等价类', () => {
  it('preserves trimmed words and source, and clears them on end', () => {
    const live = new LiveState('jarvis'); start(live, '  已完成。\n');
    assert.deepEqual(live.speech(), { source: 'session', sessionId: 'worker', text: '已完成。' });
    live.speechSignal({ phase: 'end', id: 'a' }); assert.equal(live.speech(), null);
  });
  it('replaces text on the next start and ignores an older end', () => {
    const live = new LiveState('jarvis'); start(live, '旧'); start(live, '新', 'b');
    live.speechSignal({ phase: 'end', id: 'a' }); assert.equal(live.speech()?.text, '新');
  });
});
describe('边界值', () => {
  for (const length of [119, 120, 121]) it(`${length} Unicode code points are capped at 120`, () => {
    const live = new LiveState('jarvis'); start(live, '😀'.repeat(length));
    assert.equal(live.speech()?.text, '😀'.repeat(Math.min(length, 120)));
  });
  it('expires stale text at the speech timeout', () => {
    let now = 0; const live = new LiveState('jarvis', () => now); start(live, '有效');
    now = SPEECH_STALE_MS - 1; assert.equal(live.speech()?.text, '有效');
    now++; assert.equal(live.speech(), null);
  });
});
describe('异常路径', () => {
  for (const text of [undefined, null, 5, {}, [], '', ' \n\t']) it(`omits invalid text ${JSON.stringify(text)}`, () => {
    const live = new LiveState('jarvis'); start(live, text);
    assert.deepEqual(live.speech(), { source: 'session', sessionId: 'worker' });
  });
});
