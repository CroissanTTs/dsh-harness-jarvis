import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore, type LongEntry } from '../src/memory/store.ts';
import { MemorySection, renderMemorySection } from '../src/memory/section.ts';
let root: string, store: MemoryStore;
const now = Date.parse('2026-09-24T10:00:00Z');
const entry = (id: string, changes: Partial<LongEntry> = {}): LongEntry => ({ id, tag: 'note', source: 'remember', created: new Date(now).toISOString(), key: id, ...changes });
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'jv-memory-section-')); store = new MemoryStore({ rootDir: root }); });
afterEach(async () => { mock.restoreAll(); await rm(root, { recursive: true, force: true }); });

describe('等价类', () => {
  it('只按创建时间倒序取最新20条，注入key而非detail或tag', () => {
    const entries = Array.from({ length: 22 }, (_, i) => entry(`key${i}`, { created: new Date(now + i).toISOString(), tag: 'SECRET_TAG', detail: 'SECRET_DETAIL' }));
    const text = renderMemorySection(entries, now);
    assert.deepEqual(text.split('\n').filter(line => line.startsWith('- ')), Array.from({ length: 20 }, (_, i) => `- key${21-i}`));
    assert.doesNotMatch(text, /SECRET/);
  });
  it('首次读取已有general；会话、approvals和temp不进入人设', async () => {
    await store.writeLong('general', entry('global'));
    await store.writeLong('worker', entry('private'));
    await store.writeLong('approvals', entry('approval'));
    await store.appendTemp('worker', { at: now, type: 'user/message', text: 'temp' });
    const section = new MemorySection(store, { now: () => now });
    assert.match(await section.refresh(), /global/);
    assert.doesNotMatch(section.text(), /private|approval|temp/);
  });
  it('版本不变重用同一缓存字符串，且不再次读取存储', async () => {
    await store.writeLong('general', entry('global'));
    const section = new MemorySection(store);
    const first = await section.refresh();
    const read = mock.method(store, 'snapshotLong', () => { throw Error('must use cache'); });
    assert.strictEqual(await section.refresh(), first); assert.strictEqual(section.text(), first);
    assert.equal(read.mock.callCount(), 0);
  });
  it('成功写入和删除更新version，读取/缺失删除/其他库不更新general', async () => {
    const initial = store.version();
    const file = await store.writeLong('general', entry('one')); assert.equal(store.version(), initial + 1);
    await store.listLong('general'); await store.readLong('general', file); await store.snapshotLong('general');
    await store.removeLong('general', 'missing.html');
    await store.writeLong('worker', entry('private')); await store.writeLong('approvals', entry('approval'));
    await store.appendTemp('worker', { at: now, type: 'turn/end' });
    assert.equal(store.version(), initial + 1);
    await store.removeLong('general', file); assert.equal(store.version(), initial + 2);
  });
  it('同目录其他实例与软链接别名共享版本，下一次刷新可见新值', async () => {
    const actual = join(root, 'actual'); await mkdir(actual);
    const alias = join(root, 'alias'); await symlink(actual, alias);
    const a = new MemoryStore({ rootDir: actual }), b = new MemoryStore({ rootDir: alias });
    const section = new MemorySection(a);
    assert.equal(await section.refresh(), '');
    await b.writeLong('general', entry('first'));
    assert.equal(a.version(), b.version()); assert.match(await section.refresh(), /first/);
    await b.writeLong('general', entry('first', { key: 'updated' }));
    assert.match(await section.refresh(), /updated/);
    await b.removeLong('general', 'first.html'); assert.equal(await section.refresh(), '');
  });
  it('并发刷新共用一次snapshot，不做重复读盘', async () => {
    await store.writeLong('general', entry('one'));
    const original = store.snapshotLong.bind(store); const read = mock.method(store, 'snapshotLong', original);
    const section = new MemorySection(store);
    const values = await Promise.all(Array.from({ length: 5 }, () => section.refresh()));
    assert.ok(values.every(text => text === values[0])); assert.equal(read.mock.callCount(), 1);
  });
});

describe('边界值', () => {
  it('空库与没有合法key时空串，不显示section', async () => {
    assert.equal(renderMemorySection([], now), '');
    assert.equal(await new MemorySection(store).refresh(), '');
  });
  for (const length of [1499, 1500, 1501]) it(`总长${length}码点边界不拆emoji`, () => {
    const overhead = Array.from(renderMemorySection([entry('x')], now)).length - 1;
    const text = renderMemorySection([entry('long', { key: '😀'.repeat(length - overhead) })], now);
    assert.equal(Array.from(text).length, Math.min(length, 1500));
    assert.equal(text.endsWith('\ud83d'), false);
  });
  it('相同日期排序确定，与目录读取顺序无关；多行key转为单行', () => {
    const a = entry('a', { key: 'A\nB' }), b = entry('b');
    assert.equal(renderMemorySection([a, b], now), renderMemorySection([b, a], now));
    assert.match(renderMemorySection([a], now), /- A B/);
  });
  it('刷新时排除已过期条目，时钟变化本身不改变同version缓存', async () => {
    await store.writeLong('general', entry('expired', { expires: new Date(now).toISOString() }));
    await store.writeLong('general', entry('soon', { expires: new Date(now+1).toISOString() }));
    let time = now; const section = new MemorySection(store, { now: () => time });
    const text = await section.refresh(); assert.match(text, /soon/); assert.doesNotMatch(text, /expired/);
    time++;
    assert.strictEqual(await section.refresh(), text);
    await store.writeLong('general', entry('new'));
    assert.doesNotMatch(await section.refresh(), /soon/);
  });
});

describe('异常路径', () => {
  it('损坏HTML跳过，其余合法记忆保留', async () => {
    await store.writeLong('general', entry('good'));
    await writeFile(join(root, 'memory', 'general', 'broken.html'), '<memory>bad');
    assert.match(await new MemorySection(store).refresh(), /good/);
  });
  it('读盘失败保留旧缓存，日志失败不抛出，下次重试恢复', async () => {
    const section = new MemorySection(store, { onError: () => { throw Error('logger'); } });
    await store.writeLong('general', entry('old')); const first = await section.refresh();
    await store.writeLong('general', entry('new'));
    const read = mock.method(store, 'snapshotLong', async () => { throw Error('disk'); });
    assert.equal(await section.refresh(), first);
    read.mock.restore(); assert.match(await section.refresh(), /new/);
  });
  it('失败的写入不推进version，后续写恢复正常', async () => {
    await mkdir(join(root, 'memory', 'general', 'blocked.html'), { recursive: true });
    const version = store.version();
    await assert.rejects(store.writeLong('general', entry('blocked'))); assert.equal(store.version(), version);
    await store.writeLong('general', entry('good')); assert.equal(store.version(), version + 1);
  });
  it('snapshot等待持有写锁的写入完成，版本和文件一致', async () => {
    let release!: () => void, begun!: () => void;
    const started = new Promise<void>(r => { begun = r; }); const gate = new Promise<void>(r => { release = r; });
    const held = store.withWriteLock('general', async () => { begun(); await gate; }); await started;
    const write = store.writeLong('general', entry('new'));
    const snapshot = store.snapshotLong('general');
    release(); await Promise.all([held, write]);
    const result = await snapshot;
    assert.equal(result.version, store.version()); assert.equal(result.files.length, 1);
  });
});
