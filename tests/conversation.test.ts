import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routedInput, toConversation } from '../src/conversation.ts';

const text = (role: string, t: string, id?: string) => ({ id, role, content: [{ type: 'text', text: t }] });

// ── 等价类 ──────────────────────────────────────────────────────────────
describe('等价类', () => {
  it('用户和助手的文字按顺序保留', () => {
    const conv = toConversation([text('user', '你好', 'u1'), text('assistant', '在的', 'a1')]);
    assert.deepEqual(conv, [
      { id: 'u1', role: 'user', text: '你好' },
      { id: 'a1', role: 'assistant', text: '在的' },
    ]);
  });

  it('转发请求还原成用户原话，并标出目标会话', () => {
    const [line] = toConversation([text('user', routedInput('s-hammer', '跑一遍 lint'))]);
    assert.equal(line?.text, '跑一遍 lint');
    assert.equal(line?.routedTo, 's-hammer');
  });

  it('inject_to_session 调用标出目标会话', () => {
    const [line] = toConversation([{
      role: 'assistant',
      content: [{ type: 'toolCall', name: 'inject_to_session', arguments: '{"session":"s-anvil","message":"x"}' }],
    }]);
    assert.equal(line?.routedTo, 's-anvil');
    assert.equal(line?.toolCalls?.[0]?.name, 'inject_to_session');
  });
});

// ── 边界值 ──────────────────────────────────────────────────────────────
describe('边界值', () => {
  it('超过上限只保留最新的', () => {
    const msgs = Array.from({ length: 25 }, (_, i) => text('user', `m${i}`));
    const conv = toConversation(msgs, 20);
    assert.equal(conv.length, 20);
    assert.equal(conv[0]?.text, 'm5');
    assert.equal(conv.at(-1)?.text, 'm24');
  });

  it('上限为 0 时返回空列表', () => {
    assert.deepEqual(toConversation([text('user', 'x')], 0), []);
  });

  it('没有 id 时按位置补一个', () => {
    assert.equal(toConversation([text('system', 's'), text('user', 'x')])[0]?.id, 'm1');
  });

  it('多段文字拼接成一条', () => {
    const [line] = toConversation([{ role: 'assistant', content: [{ type: 'text', text: '前' }, { type: 'text', text: '后' }] }]);
    assert.equal(line?.text, '前后');
  });
});

// ── 异常路径 ────────────────────────────────────────────────────────────
describe('异常路径', () => {
  it('系统消息、工具结果、空消息被过滤', () => {
    const conv = toConversation([
      text('system', 'persona'),
      { role: 'tool', content: [{ type: 'text', text: 'result' }] },
      { role: 'assistant', content: [] },
      null,
      'garbage',
    ]);
    assert.deepEqual(conv, []);
  });

  it('工具参数不是 JSON 时不崩溃，也不标目标', () => {
    const [line] = toConversation([{ role: 'assistant', content: [{ type: 'tool_call', name: 'inject_to_session', arguments: '{oops' }] }]);
    assert.equal(line?.routedTo, undefined);
    assert.equal(line?.toolCalls?.[0]?.args, '{oops');
  });

  it('content 不是数组时视为空', () => {
    assert.deepEqual(toConversation([{ role: 'user', content: 'plain' }]), []);
  });
});
