import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore, parseMemory, type LongEntry } from '../src/memory/store.ts';
import { approvalMemory } from '../src/memory/approval.ts';
import { renderApprovalHtml, type ApprovalRecord } from '../src/approvals.ts';
import { writeApproval } from '../src/approval-store.ts';
import { remember, recall, scoreMemory } from '../src/memory/tools.ts';

let root: string, store: MemoryStore;
const now = Date.parse('2026-09-24T10:00:00Z');
const note = (id: string, changes: Partial<LongEntry> = {}): LongEntry => ({
  id, tag: 'note', created: new Date(now).toISOString(), source: 'remember', key: id, ...changes,
});
const lines = (text: string) => text.split('\n').filter(line => line.startsWith('- '));
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'jv-memory-tools-')); store = new MemoryStore({ rootDir: root }); });
afterEach(async () => { mock.restoreAll(); await rm(root, { recursive: true, force: true }); });

describe('等价类', () => {
  it('remember拆第一句写general，保存tag、source、时间和到期日', async () => {
    assert.equal(await remember(store, { content: ' 用中文回复。请简洁说明。 ', tag: '偏好', expiresDays: 2 }, now), '记住了');
    const [file] = await store.listLong('general');
    const entry = parseMemory((await store.readLong('general', file))!)!;
    assert.equal(entry.key, '用中文回复。'); assert.equal(entry.detail, '请简洁说明。');
    assert.equal(entry.tag, '偏好'); assert.equal(entry.source, 'remember');
    assert.equal(entry.created, new Date(now).toISOString());
    assert.equal(entry.expires, new Date(now + 2 * 86400000).toISOString());
  });
  it('remember会话原始id透传，安全落盘，空session写general且默认tag', async () => {
    await remember(store, { content: 'project choice', session: '../工程 A' }, now);
    const [file] = await store.listLong('../工程 A');
    const entry = parseMemory((await store.readLong('../工程 A', file))!)!;
    assert.equal(entry.session, '../工程 A'); assert.equal(entry.tag, 'note');
    for (const session of ['', '   ']) await remember(store, { content: 'global choice', session }, now);
    assert.equal((await store.listLong('general')).length, 2);
  });
  it('同一毫秒的多次remember各自保存，不覆盖', async () => {
    await Promise.all(Array.from({ length: 8 }, () => remember(store, { content: 'keep' }, now)));
    assert.equal((await store.listLong('general')).length, 8);
  });
  it('key/tag/detail权重3/2/1，同一词不因重复query或重复正文加倍', () => {
    assert.equal(scoreMemory('Choice choice', note('choice', { tag: 'choice', detail: 'choice choice' })), 6);
    assert.equal(scoreMemory('约定', note('约', { tag: '定', detail: '定' })), 6);
    assert.equal(scoreMemory('API约定', note('API约定')), 9);
  });
  it('按分数优先、同分新旧排序，输出不含detail', async () => {
    await store.writeLong('general', note('key-old', { key: 'choice old', created: new Date(now - 1000).toISOString() }));
    await store.writeLong('general', note('detail-new', { detail: 'choice SECRET' }));
    await store.writeLong('general', note('tag-new', { tag: 'choice' }));
    await store.writeLong('general', note('key-new', { key: 'choice new' }));
    const text = await recall(store, { query: 'CHOICE' }, now);
    assert.deepEqual(lines(text), [
      '- [note] choice new（来源：general，2026-09-24）', '- [note] choice old（来源：general，2026-09-24）',
      '- [choice] tag-new（来源：general，2026-09-24）', '- [note] detail-new（来源：general，2026-09-24）',
    ]);
    assert.equal(text.includes('SECRET'), false);
  });
  it('中文单字与空白分隔英文混合查询，无命中不返回', async () => {
    await store.writeLong('general', note('a', { key: '中文 API choice' }));
    await store.writeLong('general', note('b', { key: 'irrelevant' }));
    assert.equal(lines(await recall(store, { query: '中 API' }, now)).length, 1);
    assert.equal(lines(await recall(store, { query: 'notfound' }, now)).length, 0);
  });
  it('仅general和指定会话，不泄漏其他会话，来源使用真实store', async () => {
    for (const scope of ['general', 'a', 'b']) await store.writeLong(scope, note(scope, { key: 'shared', session: 'forged' }));
    assert.equal(lines(await recall(store, { query: 'shared' }, now)).length, 1);
    const text = await recall(store, { query: 'shared', session: 'a' }, now);
    assert.equal(lines(text).length, 2); assert.match(text, /来源：a/); assert.doesNotMatch(text, /forged|来源：b/);
  });
  it('审批关键词启用J3 HTML检索，解码转义且只返回关键点与来源', async () => {
    await writeApproval(store, {
      fingerprint: 'bash:echo', ts: new Date(now).toISOString(), session: { id: 'worker', cwd: '/x', managed: true },
      operation: { tool: 'bash', command: 'echo <你好> & "ok"', args: 'sensitive args' },
      context: 'SECRET detail', decision: { allow: false, source: 'user', reason: 'reason' }, tier: { value: '', notes: '' },
    });
    assert.equal(lines(await recall(store, { query: 'echo' }, now)).length, 0);
    for (const query of ['审批 echo', '拒绝']) {
      const text = await recall(store, { query }, now);
      assert.match(text, /\[审批\] 拒绝 bash: echo <你好> & "ok"/);
      assert.match(text, /来源：worker，2026-09-24/);
      assert.doesNotMatch(text, /SECRET|sensitive args/);
    }
  });
});

describe('边界值', () => {
  for (const [content, key, detail] of [
    ['No punctuation', 'No punctuation', undefined], ['He said “yes.” Next.', 'He said “yes.”', 'Next.'], ['Use Node.js. Keep v1.2.', 'Use Node.js.', 'Keep v1.2.'],
    ['第一行\n第二行', '第一行', '第二行'], ['真的吗？！接着做。', '真的吗？！', '接着做。'],
  ]) it(`句子拆分：${content}`, async () => {
    await remember(store, { content: content! }, now);
    const [file] = await store.listLong('general'); const value = parseMemory((await store.readLong('general', file))!)!;
    assert.equal(value.key, key); assert.equal(value.detail, detail);
  });
  it('detail最多500个Unicode码点，不拆emoji', async () => {
    await remember(store, { content: 'Key! ' + '😀'.repeat(501) }, now);
    const [file] = await store.listLong('general');
    assert.equal(parseMemory((await store.readLong('general', file))!)?.detail, '😀'.repeat(500));
  });
  it('limit默认5、0、11，负数和小数归一化', async () => {
    for (let i = 0; i < 12; i++) await store.writeLong('general', note(String(i), { key: 'match' }));
    for (const [limit, expected] of [[undefined, 5], [0, 0], [11, 10], [-1, 0], [2.9, 2]] as const) {
      assert.equal(lines(await recall(store, { query: 'match', limit }, now)).length, expected);
    }
  });
  it('过期日前1ms保留、相等和已过期跳过，无期限保留', async () => {
    for (const [id, delta] of [['past', -1], ['equal', 0], ['future', 1]] as const) {
      await store.writeLong('general', note(id, { key: 'choice', expires: new Date(now + delta).toISOString() }));
    }
    await store.writeLong('general', note('forever', { key: 'choice' }));
    assert.equal(lines(await recall(store, { query: 'choice' }, now)).length, 2);
    await remember(store, { content: 'immediate', expiresDays: 0 }, now);
    assert.equal(lines(await recall(store, { query: 'immediate' }, now)).length, 0);
  });
  it('审批长命令只回传160字关键点，全文仍能参与检索', async () => {
    await writeApproval(store, {
      fingerprint: 'bash:test', ts: new Date(now).toISOString(), session: { id: 'worker', cwd: '', managed: false },
      operation: { tool: 'bash', command: 'x'.repeat(200) + ' unique-tail', args: '' }, context: '',
      decision: { allow: true, source: 'user', reason: '' }, tier: { value: '', notes: '' },
    });
    const text = await recall(store, { query: '批准 unique-tail' }, now);
    assert.equal(lines(text).length, 1); assert.equal(text.includes('unique-tail'), false);
    assert.ok(text.length < 220);
  });
  it('空库、不存在会话、纯标点query返回空结果', async () => {
    for (const args of [{ query: 'x' }, { query: 'x', session: 'missing' }, { query: '?!。' }]) {
      assert.equal(await recall(store, args, now), '没有找到相关记忆');
    }
  });
});

describe('异常路径', () => {
  it('坏HTML、已删除文件和单文件读取异常跳过，正常条目仍返回', async () => {
    await store.writeLong('general', note('good', { key: 'choice' }));
    await writeFile(join(root, 'memory', 'general', 'broken.html'), '<memory invalid>');
    for (const id of ['gone', 'unreadable']) await store.writeLong('general', note(id, { key: 'choice' }));
    const read = store.readLong.bind(store);
    mock.method(store, 'readLong', async (scope: string, file: string) => {
      if (file === 'gone.html') return undefined;
      if (file === 'unreadable.html') throw Error('EACCES');
      return read(scope, file);
    });
    assert.equal(lines(await recall(store, { query: 'choice' }, now)).length, 1);
  });
  it('审批HTML完整转义往返，格式损坏、坏日期及无效allow跳过', async () => {
    const raw = `<>&"' &lt;中文`;
    const record: ApprovalRecord = {
      fingerprint: raw, ts: new Date(now).toISOString(), session: { id: raw, cwd: raw, managed: false },
      operation: { tool: raw, command: raw, args: raw }, context: raw,
      decision: { allow: true, source: raw, reason: raw }, tier: { value: raw, notes: raw },
    };
    const html = renderApprovalHtml(record);
    const parsed = approvalMemory(html)!;
    assert.equal(parsed.key, `批准 ${raw}: ${raw}`); assert.equal(parsed.session, raw);
    assert.ok(parsed.detail.includes(raw));
    for (const broken of [html.slice(0, -15), html.replace('allow="true"', 'allow="maybe"'),
      html.replace(record.ts, 'invalid'), html.replace('&lt;', '&bad;'),
      html.replace('fingerprint=', 'unknown='), html.replace('<context>', '<script>'),
      html.replace('managed="false"', 'managed="maybe"'), html.replace('allow="true"', 'allow="true" allow="false"')]) {
      assert.equal(approvalMemory(broken), undefined);
    }
    await mkdir(join(root, 'memory', 'approvals'), { recursive: true });
    await writeFile(join(root, 'memory', 'approvals', 'bad.html'), '<approval invalid>');
    await writeApproval(store, record);
    assert.equal(lines(await recall(store, { query: '批准' }, now)).length, 1);
  });
  it('空白及非字符串content/query拒绝，保留库不能冒充session', async () => {
    for (const content of ['', ' \n ', 1]) await assert.rejects(remember(store, { content: content as string }, now));
    for (const query of ['', ' \n ', 1]) await assert.rejects(recall(store, { query: query as string }, now));
    await assert.rejects(remember(store, { content: 'x', session: 'approvals' }, now));
    await assert.rejects(recall(store, { query: 'x', session: 'approvals' }, now));
  });
  it('无效expiresDays及limit拒绝，不写入数据', async () => {
    for (const expiresDays of [-1, NaN, Infinity, 1e20]) await assert.rejects(remember(store, { content: 'x', expiresDays }, now));
    for (const limit of [NaN, Infinity]) await assert.rejects(recall(store, { query: 'x', limit }, now));
    assert.deepEqual(await store.listLong('general'), []);
  });
  it('写入失败不报记住了，目录读取错误不伪装空库', async () => {
    await mkdir(join(root, 'memory')); await writeFile(join(root, 'memory', 'general'), 'blocked');
    await assert.rejects(remember(store, { content: 'x' }, now));
    await assert.rejects(recall(store, { query: 'x' }, now));
    assert.equal(await readFile(join(root, 'memory', 'general'), 'utf8'), 'blocked');
  });
});
