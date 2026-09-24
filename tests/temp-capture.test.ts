import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toTempRecord, captureTemp } from '../src/memory/capture.ts';
const at = Date.parse('2026-09-24T10:00:00Z');
const event = (type: string, data: unknown) => ({ type, time: at, data });
const text = (value: string) => ({ type: 'text', text: value });

describe('等价类', () => {
  it('user仅拼接顶层文本，忽略附件、工具结果和额外字段', () => {
    assert.deepEqual(toTempRecord(event('user/message', { content: [text('一'), { type: 'image', url: 'SECRET' }, text('二'),
      { type: 'tool-result', content: [text('OUTPUT')] }], secret: 'SECRET' })), { at, type: 'user/message', text: '一\n二' });
  });
  it('assistant只取最终文本块，忽略推理、工具参数与stream', () => {
    assert.deepEqual(toTempRecord(event('assistant/message', { message: { content: [
      text('中间文本'), { type: 'reasoning', text: 'THINKING' }, { type: 'tool-call', arguments: 'ARGS' }, text('最终回复'),
    ] }, stream: [{ text: 'SECRET' }] })), { at, type: 'assistant/message', text: '最终回复' });
  });
  it('tool/result仅保存工具名和错误布尔，不读取output/meta/error详情', () => {
    for (const isError of [false, true, undefined]) {
      assert.deepEqual(toTempRecord(event('tool/result', { message: { content: [{ type: 'tool-result', isError,
        get content() { throw Error('must not read output'); } }] }, meta: 'SECRET', error: { code: 'SECRET' } }), 'bash'),
        { at, type: 'tool/result', tool: 'bash', isError: isError === true });
    }
  });
  it('turn/end只保留reason.kind', () => {
    assert.deepEqual(toTempRecord(event('turn/end', { turn: 9, reason: { kind: 'error', message: 'SECRET' } })),
      { at, type: 'turn/end', reason: 'error' });
  });
  it('捕获从session旧事件按callId找工具名，不保存调用参数', async () => {
    const records: unknown[] = [];
    const store: any = { appendTemp: async (...args: unknown[]) => { records.push(args); } };
    const events = [event('tool/call', { callId: 'call', name: 'bash', get arguments() { throw Error('no args'); } }),
      event('tool/call', { callId: 'other', name: 'wrong' })];
    await captureTemp(store, { id: 'worker', eventAt: (n: number) => events[n] }, {
      ...event('tool/result', { message: { source: { kind: 'tool', callId: 'call' }, content: [{ type: 'tool-result', toolCallId: 'call', isError: false }] } }), seq: 2,
    }, () => {});
    assert.deepEqual(records, [['worker', { at, type: 'tool/result', tool: 'bash', isError: false }]]);
  });
});

describe('边界值', () => {
  for (const [kind, max] of [['user/message', 500], ['assistant/message', 800]] as const) {
    for (const size of [max - 1, max, max + 1]) it(`${kind} ${size}码点边界不拆emoji`, () => {
      const message = { content: [text('😀'.repeat(size))] };
      const data = kind === 'user/message' ? message : { message };
      assert.equal(toTempRecord(event(kind, data))?.text, '😀'.repeat(Math.min(size, max)));
    });
  }
  it('只有空文本、只有推理或没有最终提交的assistant不记', () => {
    for (const data of [{ message: { content: [{ type: 'reasoning', text: 'SECRET' }] } },
      { message: { content: [text('')] } }, { message: { content: [text('prefix')] }, interrupted: true }]) {
      assert.equal(toTempRecord(event('assistant/message', data)), null);
    }
  });
  it('epoch时间0合法，不用当前时间覆盖事件时间', () => {
    assert.deepEqual(toTempRecord({ ...event('turn/end', { reason: { kind: 'completed' } }), time: 0 }),
      { at: 0, type: 'turn/end', reason: 'completed' });
  });
});

describe('异常路径', () => {
  it('未知/缺字段/非法时间返回null', () => {
    for (const value of [null, {}, event('assistant/attempt', {}), event('tool/call', {}), event('turn/start', {}),
      event('tool/result', {}), event('user/message', {}), event('turn/end', { reason: { kind: 1 } }),
      { ...event('user/message', { content: [text('x')] }), time: NaN },
      { ...event('user/message', { content: [text('x')] }), time: -1 }]) assert.equal(toTempRecord(value), null);
    assert.equal(toTempRecord(event('tool/result', { message: { content: [{ type: 'tool-result', isError: 'yes' }] } }), 'bash'), null);
  });
  it('工具未启动的合法错误结果可从assistant工具块查名，不读取参数', async () => {
    const records: unknown[] = [];
    const prior = event('assistant/message', { message: { content: [
      { type: 'reasoning', get text() { throw Error('no reasoning'); } },
      { type: 'text', get text() { throw Error('no text'); } },
      { type: 'tool-call', id: 'call', name: 'bash', get arguments() { throw Error('no args'); } },
    ] } });
    await captureTemp({ appendTemp: async (...args: unknown[]) => { records.push(args); } } as any,
      { id: 'worker', eventAt: () => prior }, { ...event('tool/result', { error: { code: 'TOOL_NOT_STARTED' },
        message: { source: { kind: 'tool', callId: 'call' }, content: [{ type: 'tool-result', toolCallId: 'call', isError: true }] },
      }), seq: 1 }, () => {});
    assert.deepEqual(records, [['worker', { at, type: 'tool/result', tool: 'bash', isError: true }]]);
  });
  it('缺工具关联不编造名称，也不回退工具输出', async () => {
    let writes = 0;
    await captureTemp({ appendTemp: async () => { writes++; } } as any, { id: 'worker', eventAt: () => undefined },
      { ...event('tool/result', { message: { source: { callId: 'missing' }, content: [{ type: 'tool-result', isError: true }] } }), seq: 1 }, () => {});
    assert.equal(writes, 0);
  });
  it('写入、映射及日志失败均不把异常抛给宿主', async () => {
    let errors = 0;
    const onError = () => { errors++; throw Error('logging'); };
    await captureTemp({ appendTemp: async () => { throw Error('disk'); } } as any, { id: 'worker' }, event('turn/end', { reason: { kind: 'completed' } }), onError);
    await captureTemp({} as any, { id: 'worker' }, { get type() { throw Error('payload'); } }, onError);
    assert.equal(errors, 2);
  });
});
