import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore, renderMemory, parseMemory, safeSegment, type LongEntry } from '../src/memory/store.ts';

let root: string;
const now = Date.parse('2026-09-24T10:00:00.000Z');
const entry = (id = 'note'): LongEntry => ({ id, tag: 'preference', created: new Date(now).toISOString(), source: 'remember', key: '用中文回复' });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise<void>(r => setImmediate(r));
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'jarvis-memory-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('等价类', () => {
  it('长期条目在general、会话和approvals中独立读写删除', async () => {
    const store = new MemoryStore({ rootDir: root });
    for (const scope of ['general', 'worker', 'approvals']) {
      const file = await store.writeLong(scope, entry());
      assert.deepEqual(await store.listLong(scope), [file]);
      assert.deepEqual(parseMemory((await store.readLong(scope, file))!), entry());
      assert.equal(await store.removeLong(scope, file), true);
      assert.deepEqual(await store.listLong(scope), []);
    }
  });
  it('按UTC日期追加JSONL并按since包含边界读取', async () => {
    const store = new MemoryStore({ rootDir: root });
    await store.appendTemp('worker', { at: now - 86400000, type: 'user/message', text: '昨天' });
    await store.appendTemp('worker', { at: now, type: 'turn/end', reason: 'completed' });
    assert.deepEqual(await readdir(join(root, 'temp', 'worker')), ['2026-09-23.jsonl', '2026-09-24.jsonl']);
    assert.equal((await store.readTemp('worker')).length, 2);
    assert.deepEqual(await store.readTemp('worker', { since: now }), [{ session: 'worker', at: now, type: 'turn/end', reason: 'completed' }]);
  });
  it('两个写串行，多读并发，读写互斥且等候写优先于新读', async () => {
    const store = new MemoryStore({ rootDir: root });
    const started = deferred(), release = deferred(); const order: string[] = [];
    const first = store.withReadLock('general', async () => { order.push('r1'); started.resolve(); await release.promise; });
    await started.promise;
    const second = store.withReadLock('general', async () => { order.push('r2'); await release.promise; });
    await tick(); assert.deepEqual(order, ['r1', 'r2']);
    const write1 = store.withWriteLock('general', async () => { order.push('w1'); await tick(); order.push('w1-end'); });
    const read = store.withReadLock('general', () => { order.push('r3'); });
    const write2 = store.withWriteLock('general', () => { order.push('w2'); });
    await tick(); assert.deepEqual(order, ['r1', 'r2']);
    release.resolve(); await Promise.all([first, second, write1, read, write2]);
    assert.deepEqual(order, ['r1', 'r2', 'w1', 'w1-end', 'w2', 'r3']);
  });
  it('不同store写并发，lock.json记录所有活动写且结束后清理', async () => {
    const store = new MemoryStore({ rootDir: root, now: () => now });
    const a = deferred(), b = deferred(), release = deferred();
    const first = store.withWriteLock('general', async () => { a.resolve(); await release.promise; });
    await a.promise;
    const second = store.withWriteLock('approvals', async () => { b.resolve(); await release.promise; });
    await b.promise;
    const journal = JSON.parse(await readFile(join(root, 'lock.json'), 'utf8'));
    assert.deepEqual(journal.writes.map((w: any) => w.store).sort(), ['approvals', 'general']);
    assert.ok(journal.writes.every((w: any) => w.startedAt === now));
    release.resolve(); await Promise.all([first, second]);
    await assert.rejects(readFile(join(root, 'lock.json')), { code: 'ENOENT' });
  });
  it('同一会话temp和长期共享锁，两个实例也共享相同目录的锁', async () => {
    const a = new MemoryStore({ rootDir: root });
    const b = new MemoryStore({ rootDir: root });
    const begun = deferred(), release = deferred();
    const lock = a.withWriteLock('worker', async () => { begun.resolve(); await release.promise; });
    await begun.promise;
    let done = false;
    const append = b.appendTemp('worker', { at: now, type: 'turn/end' }).then(() => { done = true; });
    await tick(); assert.equal(done, false);
    release.resolve(); await Promise.all([lock, append]); assert.equal(done, true);
  });
  it('配置根目录的真实路径与软链接共用同一写锁', async () => {
    const actual = join(root, 'actual'); await mkdir(actual);
    const alias = join(root, 'alias'); await symlink(actual, alias);
    const a = new MemoryStore({ rootDir: actual }), b = new MemoryStore({ rootDir: alias });
    const begun = deferred(), release = deferred(); let entered = false;
    const first = a.withWriteLock('general', async () => { begun.resolve(); await release.promise; });
    await begun.promise;
    await b.ready();
    const second = b.withReadLock('general', () => { entered = true; });
    try { await tick(); assert.equal(entered, false); }
    finally { release.resolve(); await Promise.all([first, second]); }
    assert.equal(entered, true);
  });
  it('配置路径别名共享诊断，独立store的并发写都保留', async () => {
    const actual = join(root, 'actual'); await mkdir(actual);
    const alias = join(root, 'alias'); await symlink(actual, alias);
    const a = new MemoryStore({ rootDir: actual }), b = new MemoryStore({ rootDir: alias });
    const begunA = deferred(), begunB = deferred(), releaseA = deferred(), releaseB = deferred();
    const first = a.withWriteLock('general', async () => { begunA.resolve(); await releaseA.promise; });
    await begunA.promise;
    const second = b.withWriteLock('approvals', async () => { begunB.resolve(); await releaseB.promise; });
    try {
      await begunB.promise;
      const path = join(actual, 'lock.json');
      const active = () => readFile(path, 'utf8').then(text => JSON.parse(text).writes.map((w: any) => w.store));
      assert.deepEqual((await active()).sort(), ['approvals', 'general']);
      releaseA.resolve(); await first;
      assert.deepEqual(await active(), ['approvals']);
      releaseB.resolve(); await second;
      await assert.rejects(readFile(path), { code: 'ENOENT' });
    } finally { releaseA.resolve(); releaseB.resolve(); await Promise.all([first, second]); }
  });
  it('不同大小写的scope与条目id保持独立，不覆盖保留库', async () => {
    const store = new MemoryStore({ rootDir: root });
    await store.writeLong('general', entry('Note'));
    await store.writeLong('general', entry('note'));
    assert.equal((await store.listLong('general')).length, 2);
    assert.deepEqual(await store.listLong('GENERAL'), []);
    for (const scope of ['worker', 'Worker', 'GENERAL', 'APPROVALS']) await store.writeLong(scope, entry(scope));
    for (const scope of ['worker', 'Worker', 'GENERAL', 'APPROVALS']) {
      const files = await store.listLong(scope);
      assert.equal(files.length, 1);
      assert.equal(parseMemory((await store.readLong(scope, files[0]))!)?.id, scope);
    }
    assert.deepEqual(await store.listLong('approvals'), []);
  });
  it('HTML所有字段转义并对称往返，包括实体字面量和换行', () => {
    const raw = `<>&"' &lt;\n中文😀`;
    const value: LongEntry = { ...entry(raw), tag: raw, intent: raw, session: raw, expires: '', key: raw, detail: raw, ref: { session: raw, turn: raw } };
    const html = renderMemory(value);
    assert.ok(html.includes('&lt;&gt;&amp;&quot;&#39;'));
    assert.deepEqual(parseMemory(html), value);
  });
});

describe('边界值', () => {
  it('detail恰好500字符保留，501截断，不拆Unicode码点', () => {
    for (const n of [0, 500, 501]) {
      const detail = '😀'.repeat(n);
      assert.equal(parseMemory(renderMemory({ ...entry(), detail }))?.detail, '😀'.repeat(Math.min(n, 500)));
    }
  });
  it('合法前导点和横线的id可列出、读取及删除', async () => {
    const store = new MemoryStore({ rootDir: root });
    for (const id of ['.note', '-note', 'a'.repeat(1000)]) {
      const file = await store.writeLong('general', entry(id));
      assert.ok((await store.listLong('general')).includes(file));
      assert.equal(parseMemory((await store.readLong('general', file))!)?.id, id);
      assert.equal(await store.removeLong('general', file), true);
    }
  });
  it('临时记录日期范围覆盖epoch到四位年份最后一毫秒，超界拒绝', async () => {
    const store = new MemoryStore({ rootDir: root });
    const last = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
    await store.appendTemp('worker', { at: 0, type: 'first' });
    await store.appendTemp('worker', { at: last, type: 'last' });
    await assert.rejects(store.appendTemp('worker', { at: last + 1, type: 'too-late' }));
    assert.deepEqual((await store.readTemp('worker')).map(record => record.type), ['first', 'last']);
  });
  it('首次空库读取不创建目录，缺失条目读undefined、删除false', async () => {
    const store = new MemoryStore({ rootDir: root });
    assert.deepEqual(await store.readTemp('worker'), []);
    assert.deepEqual(await store.listLong('general'), []);
    assert.equal(await store.readLong('general', 'missing.html'), undefined);
    assert.equal(await store.removeLong('general', 'missing.html'), false);
  });
  it('同id原子替换且没有临时文件残留', async () => {
    const store = new MemoryStore({ rootDir: root });
    const file = await store.writeLong('general', entry());
    await store.writeLong('general', { ...entry(), key: '更新' });
    assert.equal(parseMemory((await store.readLong('general', file))!)?.key, '更新');
    assert.deepEqual(await readdir(join(root, 'memory', 'general')), [file]);
  });
  for (const age of [59999, 60000, 60001]) it(`启动残留锁年龄${age}ms，只有超过60秒清理`, async () => {
    const lock = join(root, 'lock.json');
    await writeFile(lock, JSON.stringify({ writes: [{ store: 'general', startedAt: now - age }] }));
    await new MemoryStore({ rootDir: root, now: () => now }).ready();
    if (age > 60000) await assert.rejects(readFile(lock), { code: 'ENOENT' });
    else assert.ok((await readFile(lock, 'utf8')).includes('general'));
  });
});

describe('异常路径', () => {
  it('路径安全化限制单段，变化名称不与已有安全名称碰撞', async () => {
    for (const name of ['../x', '..', '.', '中文', 'a/b', 'a\\b']) {
      const safe = safeSegment(name);
      assert.match(safe, /^[A-Za-z0-9._-]+$/);
      assert.notEqual(safe, '.'); assert.notEqual(safe, '..');
      const store = new MemoryStore({ rootDir: root });
      await store.appendTemp(name, { at: now, type: 'test' });
      assert.equal((await store.readTemp(name)).length, 1);
    }
    assert.notEqual(safeSegment('a/b'), safeSegment('a_b'));
    assert.notEqual(safeSegment('a/b'), safeSegment(safeSegment('a/b')));
    assert.throws(() => safeSegment(''));
  });
  it('文件参数拒绝路径穿越和非HTML文件', async () => {
    const store = new MemoryStore({ rootDir: root });
    for (const file of ['../outside.html', '/outside.html', '..', 'x.jsonl', 'a\\b.html']) {
      await assert.rejects(store.readLong('general', file));
      await assert.rejects(store.removeLong('general', file));
    }
  });
  it('损坏JSONL行和损坏HTML可跳过，合法记录仍可读', async () => {
    const store = new MemoryStore({ rootDir: root });
    await store.appendTemp('worker', { at: now, type: 'test' });
    const file = join(root, 'temp', 'worker', '2026-09-24.jsonl');
    await writeFile(file, 'broken\n{}\n'+await readFile(file, 'utf8'));
    assert.equal((await store.readTemp('worker')).length, 1);
    for (const html of ['', '<memory/>', '<memory><key>x</memory>', renderMemory(entry()).replace('source="remember"', 'source="unknown"')]) assert.equal(parseMemory(html), undefined);
  });
  it('崩溃留下无换行的JSONL尾行，不吞掉后续成功追加的事件', async () => {
    const store = new MemoryStore({ rootDir: root });
    await store.appendTemp('worker', { at: now, type: 'old' });
    const path = join(root, 'temp', 'worker', '2026-09-24.jsonl');
    await writeFile(path, '{"session":"worker","at":');
    await store.appendTemp('worker', { at: now, type: 'new' });
    assert.deepEqual((await store.readTemp('worker')).map(record => record.type), ['new']);
    await writeFile(path, JSON.stringify({ session: 'worker', at: now, type: 'valid-tail' }));
    await store.appendTemp('worker', { at: now, type: 'newer' });
    assert.deepEqual((await store.readTemp('worker')).map(record => record.type), ['valid-tail', 'newer']);
  });
  it('操作抛错或磁盘写失败后释放锁，后续写能完成', async () => {
    const store = new MemoryStore({ rootDir: root });
    await assert.rejects(store.withWriteLock('general', () => { throw Error('failure'); }), /failure/);
    await mkdir(join(root, 'memory'), { recursive: true });
    await writeFile(join(root, 'memory', 'general'), 'blocked');
    await assert.rejects(store.writeLong('general', entry()));
    await rm(join(root, 'memory', 'general'));
    const file = await store.writeLong('general', entry());
    assert.ok(await store.readLong('general', file));
  });
  it('store目录及文件符号链接不能读取或写到目录外', async () => {
    const outside = join(root, 'outside'); await mkdir(outside);
    await mkdir(join(root, 'memory')); await symlink(outside, join(root, 'memory', 'general'));
    const store = new MemoryStore({ rootDir: root });
    await assert.rejects(store.writeLong('general', entry()));
    await assert.rejects(store.listLong('general'));
    assert.deepEqual(await readdir(outside), []);
  });
  it('原子发布失败清理临时文件，后续写能继续', async () => {
    const store = new MemoryStore({ rootDir: root });
    const target = join(root, 'memory', 'general', 'note.html');
    await mkdir(target, { recursive: true });
    await assert.rejects(store.writeLong('general', entry()));
    assert.deepEqual(await readdir(join(root, 'memory', 'general')), ['note.html']);
    await rm(target, { recursive: true });
    assert.equal(await store.writeLong('general', entry()), 'note.html');
  });
  it('文件符号链接不允许读删或追加，目标内容不变', async () => {
    const store = new MemoryStore({ rootDir: root });
    const target = join(root, 'outside'); await writeFile(target, 'keep');
    await mkdir(join(root, 'memory', 'general'), { recursive: true });
    await symlink(target, join(root, 'memory', 'general', 'note.html'));
    await assert.rejects(store.readLong('general', 'note.html'));
    await assert.rejects(store.removeLong('general', 'note.html'));
    await mkdir(join(root, 'temp', 'worker'), { recursive: true });
    await symlink(target, join(root, 'temp', 'worker', '2026-09-24.jsonl'));
    await assert.rejects(store.appendTemp('worker', { at: now, type: 'test' }));
    assert.equal(await readFile(target, 'utf8'), 'keep');
  });
  it('非法输入和异步拒绝不阻塞后续操作', async () => {
    const store = new MemoryStore({ rootDir: root });
    for (const session of ['', 'general', 'approvals']) await assert.rejects(store.appendTemp(session, { at: now, type: 'test' }));
    for (const at of [-1, NaN, Infinity]) await assert.rejects(store.appendTemp('worker', { at, type: 'test' }));
    await assert.rejects(store.readTemp('worker', { since: NaN }));
    await assert.rejects(store.writeLong('general', { ...entry(), created: 'bad' }));
    await assert.rejects(store.withReadLock('general', async () => { throw Error('read failed'); }), /read failed/);
    await assert.rejects(store.withWriteLock('general', async () => { throw Error('write failed'); }), /write failed/);
    assert.ok(await store.writeLong('general', entry()));
  });
  it('损坏锁诊断与诊断写失败不阻断业务或泄漏锁', async () => {
    const lock = join(root, 'lock.json'); await writeFile(lock, '{bad');
    const errors: unknown[] = [];
    const store = new MemoryStore({ rootDir: root, onError: e => { errors.push(e); } });
    await store.ready();
    await mkdir(lock); // A directory blocks journal publication, not business data.
    assert.ok(await store.writeLong('general', entry()));
    assert.ok(await store.writeLong('general', entry('next')));
    assert.ok(errors.length > 0);
  });
});
