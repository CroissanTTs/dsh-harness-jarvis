import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { oneShot, type OneShotOptions } from '../src/llm.ts';

const options: OneShotOptions = {
  provider: 'provider', model: 'model', system: 'judge', prompt: 'request', maxTokens: 200,
};
type Chunk = Record<string, unknown>;
const delta = (text: string): Chunk => ({ type: 'text-delta', text });
const finish = (kind = 'stop', message?: string): Chunk => ({
  type: 'finish', reason: { kind, ...(message ? { failure: { message } } : {}) },
});
async function* chunks(...values: Chunk[]): AsyncGenerator<Chunk> { yield* values; }
const never = <T>(): Promise<T> => new Promise(() => {});

describe('等价类', () => {
  it('按顺序拼接 text-delta，忽略推理、工具与其它分片', async () => {
    let received: Record<string, unknown> | undefined;
    const llm = { stream(opts: Record<string, unknown>) {
      received = opts;
      return chunks(delta('  hello'), { type: 'reasoning-delta', text: 'secret' },
        { type: 'tool-call-delta', text: 'tool' }, { type: 'usage' }, delta(' world  '), finish());
    } };
    assert.equal(await oneShot(llm, options), 'hello world');
    assert.deepEqual(received, {
      provider: options.provider, model: options.model, system: options.system, maxTokens: options.maxTokens,
      messages: [{ role: 'user', content: [{ type: 'text', text: options.prompt }] }],
      reasoningEffort: 'low', purpose: 'jarvis', signal: received?.signal,
    });
    assert.ok(received?.signal instanceof AbortSignal);
  });

  it('传递调用方 purpose，并保留流方法的 this', async () => {
    const llm = { name: 'service', stream(opts: Record<string, unknown>) {
      assert.equal(this.name, 'service');
      assert.equal(opts.purpose, 'jarvis-judge');
      return chunks(delta('ok'), finish());
    } };
    assert.equal(await oneShot(llm, { ...options, purpose: 'jarvis-judge' }), 'ok');
  });

  it('finish 立即终止读取，不等待阻塞的 iterator.return', async () => {
    let reads = 0;
    let closes = 0;
    const llm = { stream: () => ({ [Symbol.asyncIterator]() { return {
      next: async () => ({ done: false, value: ++reads === 1 ? delta('ok') : finish() }),
      return: () => { closes++; return never<IteratorResult<Chunk>>(); },
    }; } }) };
    assert.equal(await oneShot(llm, { ...options, timeoutMs: 30 }), 'ok');
    assert.equal(reads, 2);
    assert.equal(closes, 1);
  });

  it('不支持 reasoning effort 时仅重试一次并丢弃首次部分文本', async () => {
    const requests: Record<string, unknown>[] = [];
    const llm = { stream(opts: Record<string, unknown>) {
      requests.push(opts);
      return requests.length === 1
        ? chunks(delta('discard'), finish('error', 'model does not support reasoning effort'))
        : chunks(delta('accepted'), finish());
    } };
    assert.equal(await oneShot(llm, options), 'accepted');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].reasoningEffort, 'low');
    assert.equal('reasoningEffort' in requests[1], false);
    assert.equal(requests[0].signal, requests[1].signal);
  });
});

describe('边界值', () => {
  it('空文本、纯空白以及缺少 finish 均返回 null', async () => {
    for (const values of [[], [finish()], [delta('  \n'), finish()], [delta('partial')]]) {
      assert.equal(await oneShot({ stream: () => chunks(...values) }, options), null);
    }
  });

  it('无服务或无 stream 方法时返回 null', async () => {
    for (const llm of [null, undefined, {}, { stream: 1 }]) {
      assert.equal(await oneShot(llm, options), null);
    }
  });

  it('零超时或已经取消时不创建流', async () => {
    let calls = 0;
    const llm = { stream: () => { calls++; return chunks(delta('late'), finish()); } };
    assert.equal(await oneShot(llm, { ...options, timeoutMs: 0 }), null);
    assert.equal(await oneShot(llm, { ...options, signal: AbortSignal.abort() }), null);
    assert.equal(calls, 0);
  });

  it('无视取消且永不返回的 next 仍被超时限制', async () => {
    let signal: AbortSignal | undefined;
    let closes = 0;
    const llm = { stream(opts: Record<string, unknown>) {
      signal = opts.signal as AbortSignal;
      return { [Symbol.asyncIterator]() { return {
        next: () => never<IteratorResult<Chunk>>(),
        return: () => { closes++; return never<IteratorResult<Chunk>>(); },
      }; } };
    } };
    const start = Date.now();
    assert.equal(await oneShot(llm, { ...options, timeoutMs: 10 }), null);
    assert.ok(Date.now() - start < 500);
    assert.equal(signal?.aborted, true);
    assert.equal(closes, 1);
  });

  it('重试共享总超时预算', async () => {
    let calls = 0;
    const start = Date.now();
    const llm = { async *stream() {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 30));
      yield calls === 1 ? finish('error', 'does not support reasoning effort') : delta('too late');
      yield finish();
    } };
    assert.equal(await oneShot(llm, { ...options, timeoutMs: 50 }), null);
    assert.equal(calls, 2);
    assert.ok(Date.now() - start < 250);
  });
});

describe('异常路径', () => {
  it('其它 finish 错误和取消均丢弃部分输出且不重试', async () => {
    for (const kind of ['error', 'aborted']) {
      let calls = 0;
      const llm = { stream: () => { calls++; return chunks(delta('partial'), finish(kind, 'failure')); } };
      assert.equal(await oneShot(llm, options), null);
      assert.equal(calls, 1);
    }
  });

  it('第二次仍拒绝 reasoning effort 时停止', async () => {
    let calls = 0;
    const llm = { stream: () => { calls++; return chunks(finish('error', 'does not support reasoning effort')); } };
    assert.equal(await oneShot(llm, options), null);
    assert.equal(calls, 2);
  });

  it('流创建抛错、迭代中抛错以及重试抛错均返回 null', async () => {
    const error = new Error('failure');
    assert.equal(await oneShot({ stream() { throw error; } }, options), null);
    assert.equal(await oneShot({ async *stream() { yield delta('partial'); throw error; } }, options), null);
    let calls = 0;
    assert.equal(await oneShot({ stream() {
      if (++calls === 2) throw error;
      return chunks(finish('error', 'does not support reasoning effort'));
    } }, options), null);
    assert.equal(calls, 2);
  });

  it('超时中止传入流的 signal，处理取消造成的拒绝', async () => {
    let signal: AbortSignal | undefined;
    const llm = { stream(opts: Record<string, unknown>) {
      signal = opts.signal as AbortSignal;
      return { [Symbol.asyncIterator]() { return {
        next: () => new Promise<IteratorResult<Chunk>>((_, reject) => {
          signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      }; } };
    } };
    assert.equal(await oneShot(llm, { ...options, timeoutMs: 10 }), null);
    assert.equal(signal?.aborted, true);
  });

  it('外部取消立即结束忽略 signal 的流，并清理监听器', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10);
    let signal: AbortSignal | undefined;
    try {
      const llm = { stream(opts: Record<string, unknown>) {
        signal = opts.signal as AbortSignal;
        return { [Symbol.asyncIterator]() { return { next: () => never<IteratorResult<Chunk>>() }; } };
      } };
      assert.equal(await oneShot(llm, { ...options, signal: controller.signal }), null);
      assert.equal(signal?.aborted, true);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    } finally { clearTimeout(timer); }
  });

  it('iterator.return 抛错或拒绝不会破坏结果或泄漏 rejection', async () => {
    for (const close of [() => { throw new Error('cleanup'); }, () => Promise.reject(new Error('cleanup'))]) {
      let reads = 0;
      const llm = { stream: () => ({ [Symbol.asyncIterator]() { return {
        next: async () => ({ done: false, value: ++reads === 1 ? delta('ok') : finish() }),
        return: close,
      }; } }) };
      assert.equal(await oneShot(llm, options), 'ok');
    }
    await new Promise(resolve => setImmediate(resolve));
  });
});
