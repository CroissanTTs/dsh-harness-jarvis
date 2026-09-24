import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fingerprint, renderApprovalHtml, approvalFileName, type ApprovalRecord } from '../src/approvals.ts';
import * as approvals from '../src/approvals.ts';
import { writeApproval } from '../src/approval-store.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jv-approvals-')); });
afterEach(() => { chmodSync(dir, 0o700); rmSync(dir, { recursive: true, force: true }); });
const record = (): ApprovalRecord => ({
  fingerprint: 'bash:rm-rf-node_modules', ts: '2026-09-24T10:30:45.123Z',
  session: { id: 'worker', cwd: '/workspace/project', managed: true },
  operation: { tool: 'bash', command: 'rm -rf node_modules', args: 'rm,-rf,node_modules' },
  context: '清理依赖', decision: { allow: false, source: 'user', reason: '' },
  tier: { value: '', notes: 'Phase1:未分级' },
});

describe('等价类', () => {
  it('匹配 tool_call/input 并忽略其他工具调用，保留参数 JSON', () => {
    const messages = [{ role: 'assistant', content: [
      { type: 'tool_call', id: 'other', input: { command: 'wrong' } },
      { type: 'tool_call', id: 'call', input: { path: '/tmp/source' } },
    ] }];
    assert.deepEqual(approvals.approvalOperation(messages, 'call'), { command: '/tmp/source', args: '{"path":"/tmp/source"}' });
  });
  it('命令空白、大小写和绝对路径被规范化', () => {
    assert.equal(fingerprint('bash', '  RM  -rf /a/b/node_modules  '), 'bash:rm-rf-node_modules');
    assert.equal(fingerprint('BASH', 'cat ~/Project/README.md'), 'bash:cat-readme.md');
    assert.equal(fingerprint('read_file', '/a/B.TS'), 'read_file:b.ts');
  });
  it('渲染审批结构及完整原始命令', () => {
    const html = renderApprovalHtml(record());
    assert.match(html, /<approval fingerprint="bash:rm-rf-node_modules" ts="2026-09-24T10:30:45.123Z">/);
    assert.match(html, /<session id="worker" cwd="\/workspace\/project" managed="true"/);
    assert.match(html, /<operation tool="bash" command="rm -rf node_modules" args="rm,-rf,node_modules"/);
    assert.match(html, />worker — \/workspace\/project<\/session>/);
    assert.match(html, />bash: rm -rf node_modules<\/operation>/);
    assert.match(html, /<context>清理依赖<\/context>/);
    assert.match(html, /<decision allow="false" source="user" reason="">拒绝<\/decision>/);
    assert.match(html, /<tier value="" notes="Phase1:未分级"/);
  });
  it('创建缺失目录并完整原子发布 HTML', async () => {
    const path = await writeApproval(join(dir, 'memory', 'approvals'), record());
    assert.equal(readFileSync(path!, 'utf8'), renderApprovalHtml(record()));
    assert.equal(readdirSync(join(dir, 'memory', 'approvals')).length, 1);
  });
});

describe('边界值', () => {
  it('空命令、Unicode 和最多八词', () => {
    assert.equal(fingerprint('bash', ''), 'bash:');
    assert.equal(fingerprint('bash', '一 二'), 'bash:');
    assert.equal(fingerprint('bash', 'a b c d e f g h i'), 'bash:a-b-c-d-e-f-g-h');
    assert.equal(fingerprint('bash', 'ls /a/b/'), 'bash:ls-b');
  });
  it('文件名使用 UTC 秒，拒绝路径成分并限制字节长度', () => {
    assert.equal(approvalFileName('bash:rm-rf-node_modules', record().ts), 'bash:rm-rf-node_modules-20260924T103045.html');
    const name = approvalFileName('../你好/../' + 'a'.repeat(1000), record().ts);
    assert.match(name, /^[a-z0-9_-][a-z0-9:._-]*-20260924T103045.html$/);
    assert.ok(Buffer.byteLength(name) < 220);
  });
  it('同秒并发记录追加 -2 且已有文件绝不覆盖', async () => {
    const first = approvalFileName(record().fingerprint, record().ts);
    writeFileSync(join(dir, first), 'existing');
    const paths = await Promise.all([writeApproval(dir, record()), writeApproval(dir, record())]);
    assert.equal(readFileSync(join(dir, first), 'utf8'), 'existing');
    assert.deepEqual(paths.map(p => p!.slice(dir.length + 1)).sort(), [first.replace('.html', '-2.html'), first.replace('.html', '-3.html')]);
    assert.equal(readdirSync(dir).length, 3);
  });
});

describe('异常路径', () => {
  it('非 JSON 参数原样保存，缺失匹配不臆测命令', () => {
    const messages = [{ content: [{ type: 'toolCall', id: 'call', arguments: 'not JSON <>&' }] }];
    assert.deepEqual(approvals.approvalOperation(messages, 'call'), { command: 'not JSON <>&', args: 'not JSON <>&' });
    assert.deepEqual(approvals.approvalOperation(messages, 'missing'), { command: '', args: '' });
    assert.deepEqual(approvals.approvalOperation(messages, undefined), { command: '', args: '' });
  });
  it('undefined 命令安全处理', () => { assert.equal(fingerprint('bash', undefined), 'bash:'); });
  it('所有动态文本与属性转义 <>&双引号和单引号', () => {
    const raw = `<>&"'`;
    const value = record();
    value.fingerprint = value.ts = value.context = raw;
    value.session.id = value.session.cwd = raw;
    value.operation.tool = value.operation.command = value.operation.args = raw;
    value.decision.source = value.decision.reason = raw;
    value.tier.value = value.tier.notes = raw;
    const html = renderApprovalHtml(value);
    assert.equal(html.includes(raw), false);
    assert.equal(html.match(/&lt;&gt;&amp;&quot;&#39;/g)?.length, 16);
  });
  it('无写权限失败不抛出，错误回调也不能泄漏异常', async () => {
    chmodSync(dir, 0o500);
    let errors = 0;
    assert.equal(await writeApproval(dir, record(), () => { errors++; throw new Error('logging failed'); }), undefined);
    assert.equal(errors, 1);
    assert.deepEqual(readdirSync(dir), []);
  });
  it('父路径为文件时不抛出且原文件不变', async () => {
    const path = join(dir, 'file');
    writeFileSync(path, 'keep');
    assert.equal(await writeApproval(join(path, 'approvals'), record()), undefined);
    assert.equal(readFileSync(path, 'utf8'), 'keep');
  });
});
