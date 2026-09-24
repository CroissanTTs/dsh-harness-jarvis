import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore, TEMP_MAX_BYTES } from '../src/memory/store.ts';
let root: string, store: MemoryStore;
const at = Date.parse('2026-09-24T10:00:00Z');
const input = { at, type: 'user/message', text: '你好😀' };
const serialized = JSON.stringify({ ...input, session: 'worker' }) + '\n';
const bytes = Buffer.byteLength(serialized);
const path = () => join(root, 'temp', 'worker', '2026-09-24.jsonl');
async function seed(size: number) { await mkdir(join(root, 'temp', 'worker'), { recursive: true }); await writeFile(path(), 'x'.repeat(size - 1) + '\n'); }
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'jv-temp-cap-')); store = new MemoryStore({ rootDir: root }); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('等价类', () => {
  it('超限只追加一次truncated，重建store也不会重复', async () => {
    await seed(TEMP_MAX_BYTES + 1);
    await Promise.all(Array.from({ length: 5 }, () => store.appendTemp('worker', input)));
    await new MemoryStore({ rootDir: root }).appendTemp('worker', input);
    assert.deepEqual(await store.readTemp('worker'), [{ session: 'worker', at, type: 'truncated' }]);
  });
  it('不同会话与不同UTC日期独立限流', async () => {
    await seed(TEMP_MAX_BYTES);
    await store.appendTemp('worker', input);
    await store.appendTemp('other', input);
    await store.appendTemp('worker', { ...input, at: at + 86400000 });
    assert.equal((await store.readTemp('other')).length, 1);
    assert.deepEqual((await store.readTemp('worker')).map(r => r.type), ['truncated', 'user/message']);
  });
});
describe('边界值', () => {
  for (const delta of [-1, 0, 1]) it(`写后预计容量相对2MiB偏差${delta}字节`, async () => {
    assert.equal(TEMP_MAX_BYTES, 2 * 1024 * 1024);
    await seed(TEMP_MAX_BYTES - bytes + delta);
    await store.appendTemp('worker', input);
    assert.equal((await store.readTemp('worker'))[0]?.type, delta > 0 ? 'truncated' : 'user/message');
  });
  it('并发竞争最后一条空间：只保存一条事件及一个截断标记', async () => {
    await seed(TEMP_MAX_BYTES - bytes);
    const other = new MemoryStore({ rootDir: root });
    await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? store : other).appendTemp('worker', input)));
    assert.deepEqual((await store.readTemp('worker')).map(r => r.type), ['user/message', 'truncated']);
  });
});
describe('异常路径', () => {
  it('已有残缺尾行在超限时补换行，再写可读truncated', async () => {
    await seed(TEMP_MAX_BYTES);
    await writeFile(path(), 'x'.repeat(TEMP_MAX_BYTES));
    await store.appendTemp('worker', input);
    assert.equal((await store.readTemp('worker'))[0]?.type, 'truncated');
    const before = await readFile(path(), 'utf8');
    await store.appendTemp('worker', input);
    assert.equal(await readFile(path(), 'utf8'), before);
  });
  it('marker写入失败不锁死，恢复目录后能写入', async () => {
    await mkdir(path(), { recursive: true });
    await assert.rejects(store.appendTemp('worker', input));
    await rm(path(), { recursive: true });
    await store.appendTemp('worker', input);
    assert.equal((await store.readTemp('worker'))[0]?.type, 'user/message');
    assert.deepEqual(await readdir(join(root, 'temp', 'worker')), ['2026-09-24.jsonl']);
  });
});
