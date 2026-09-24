import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  effectiveNarration, isNarration, legacyNarration, SELF_NARRATION_NOTE, withNarrationNote,
} from '../src/narration.ts';
import { ManagedSet } from '../src/managed.ts';
import { parseRelay, planTurnEnd, relayPrompt } from '../src/judge.ts';
import { claimsTurnEnd } from '../src/turn-end.ts';

let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jv-narration-')); file = join(dir, 'managed.json'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = { status: 'open' as const, rounds: 0 };
const judging = { status: 'judging' as const, rounds: 0 };
const plan = (narration: 'self' | 'relay', rest: Record<string, unknown>) =>
  planTurnEnd({ managed: true, max: 2, narration, ...rest } as Parameters<typeof planTurnEnd>[0]);

describe('等价类', () => {
  it('两种模式都合法，按会话覆盖优先于全局默认', () => {
    assert.equal(isNarration('self'), true);
    assert.equal(isNarration('relay'), true);
    assert.equal(effectiveNarration('self', 'relay'), 'relay');
    assert.equal(effectiveNarration('relay', 'self'), 'self');
    assert.equal(effectiveNarration('relay', undefined), 'relay');
  });

  it('self 转发附一次 speak 汇报要求，relay 原样转发', () => {
    const noted = withNarrationNote('修好测试', 'self');
    assert.equal(noted, `修好测试\n\n${SELF_NARRATION_NOTE}`);
    assert.match(SELF_NARRATION_NOTE, /speak/);
    assert.equal(withNarrationNote('修好测试', 'relay'), '修好测试');
  });

  it('self 下贾维斯不接管轮次结束，relay 下接管且不再依赖判断开关', () => {
    for (const judgeEnabled of [true, false]) {
      assert.equal(claimsTurnEnd({ managed: true, task: open, judgeEnabled, narration: 'self' }), false);
      assert.equal(claimsTurnEnd({ managed: true, task: open, judgeEnabled, narration: 'relay' }), true);
    }
  });

  it('self 完成后只静默结算，只在需要续做时开口', () => {
    assert.equal(plan('self', { task: open, reasonKind: 'completed', judgeEnabled: true }), 'judge');
    assert.equal(plan('self', { task: judging, reasonKind: 'completed', judgeEnabled: true,
      verdict: { verdict: 'satisfied', summary: '好了' } }), 'done-silent');
    assert.equal(plan('self', { task: judging, reasonKind: 'completed', judgeEnabled: true,
      verdict: { verdict: 'unclear', summary: '不清楚' } }), 'done-silent');
    assert.equal(plan('self', { task: judging, reasonKind: 'completed', judgeEnabled: true,
      verdict: { verdict: 'unsatisfied', summary: '没好' } }), 'continue');
    assert.equal(plan('self', { task: open, reasonKind: 'error', judgeEnabled: true }), 'open-silent');
  });

  it('relay 判断开启时照常播报结论和失败', () => {
    assert.equal(plan('relay', { task: judging, reasonKind: 'completed', judgeEnabled: true,
      verdict: { verdict: 'satisfied', summary: '好了' } }), 'satisfied');
    assert.equal(plan('relay', { task: open, reasonKind: 'error', judgeEnabled: true }), 'fail');
  });

  it('relay 判断关闭时仍走总结路径并播报', () => {
    assert.equal(plan('relay', { task: open, reasonKind: 'completed', judgeEnabled: false }), 'judge');
    assert.equal(plan('relay', { task: judging, reasonKind: 'completed', judgeEnabled: false,
      verdict: { verdict: 'satisfied', summary: '它修好了' } }), 'satisfied');
    assert.equal(plan('relay', { task: open, reasonKind: 'blocked', judgeEnabled: false }), 'fail');
  });

  it('转述提示词以转述者口吻、把会话回复当作不可信材料', () => {
    const { system, prompt } = relayPrompt('全部测试通过');
    assert.match(system, /转述/);
    assert.match(system, /不可信/);
    assert.equal(prompt, '全部测试通过');
  });

  it('按会话覆盖可持久化、可清除，重启后读回', () => {
    const set = new ManagedSet(file);
    set.add('a'); set.add('b');
    assert.equal(set.setNarration('a', 'relay'), true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { managed: ['a', 'b'], narration: { a: 'relay' } });
    assert.equal(new ManagedSet(file).narration('a'), 'relay');
    assert.equal(new ManagedSet(file).narration('b'), undefined);
    assert.equal(set.setNarration('a', undefined), true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), ['a', 'b']);
  });
});

describe('边界值', () => {
  it('附言只加一次，结尾空白不叠加空行', () => {
    const once = withNarrationNote('任务  \n', 'self');
    assert.equal(once, `任务\n\n${SELF_NARRATION_NOTE}`);
    assert.equal(withNarrationNote(once, 'self'), once);
  });

  it('旧调用方不传模式时：判断开即转述，判断关即会话自报', () => {
    assert.equal(legacyNarration(true), 'relay');
    assert.equal(legacyNarration(false), 'self');
    assert.equal(claimsTurnEnd({ managed: true, task: open, judgeEnabled: true }), true);
    assert.equal(claimsTurnEnd({ managed: true, task: open, judgeEnabled: false }), false);
    assert.equal(planTurnEnd({ managed: true, max: 2, task: open, reasonKind: 'completed', judgeEnabled: false }), 'done-silent');
    assert.equal(planTurnEnd({ managed: true, max: 2, task: open, reasonKind: 'completed' }), 'judge');
  });

  it('续做到上限时 self 静默结束，relay 播报上限', () => {
    const unsatisfied = { verdict: 'unsatisfied' as const, summary: '没好' };
    assert.equal(plan('self', { task: judging, reasonKind: 'completed', verdict: unsatisfied, rounds: 2, judgeEnabled: true }), 'done-silent');
    assert.equal(plan('relay', { task: judging, reasonKind: 'completed', verdict: unsatisfied, rounds: 2, judgeEnabled: true }), 'limit');
    assert.equal(plan('relay', { task: judging, reasonKind: 'completed', verdict: unsatisfied, rounds: 1, judgeEnabled: true }), 'continue');
  });

  it('转述句去掉引号和换行，超过 40 字截断', () => {
    assert.equal(parseRelay('“它把测试\n都修好了”'), '它把测试 都修好了');
    const long = parseRelay('它'.repeat(80))!;
    assert.ok(Array.from(long).length <= 41);
  });

  it('没有覆盖值时保持纯数组格式，覆盖值与全局默认相同也照样保存', () => {
    const set = new ManagedSet(file);
    set.add('a');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), ['a']);
    assert.equal(set.setNarration('a', 'self'), true);
    assert.equal(set.setNarration('a', 'self'), false);
    assert.equal(new ManagedSet(file).narration('a'), 'self');
  });

  it('移出托管一并丢弃覆盖值，再纳入时回到默认', () => {
    const set = new ManagedSet(file);
    set.add('a'); set.setNarration('a', 'relay');
    set.remove('a');
    assert.equal(set.narration('a'), undefined);
    set.add('a');
    assert.equal(set.narration('a'), undefined);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), ['a']);
  });
});

describe('异常路径', () => {
  it('非法模式值一律回落到全局默认', () => {
    for (const bad of ['SELF', '', null, 1, {}, 'default']) {
      assert.equal(isNarration(bad), false);
      assert.equal(effectiveNarration('self', bad), 'self');
    }
  });

  it('未托管或无任务时两种模式都不接管也不播报', () => {
    for (const narration of ['self', 'relay'] as const) {
      assert.equal(claimsTurnEnd({ managed: false, task: open, judgeEnabled: true, narration }), false);
      assert.equal(claimsTurnEnd({ managed: true, judgeEnabled: true, narration }), false);
      assert.equal(planTurnEnd({ managed: true, max: 2, narration, reasonKind: 'completed' }), 'ignore');
      assert.equal(plan(narration, { task: open, reasonKind: 'aborted', judgeEnabled: true }), 'drop');
    }
  });

  it('空的或非文本的转述结果不可朗读', () => {
    for (const bad of [null, undefined, '', '   ', '“”', 42]) assert.equal(parseRelay(bad), null);
  });

  it('未托管的会话或非法值不能设置覆盖', () => {
    const set = new ManagedSet(file);
    assert.equal(set.setNarration('ghost', 'relay'), false);
    set.add('a');
    assert.equal(set.setNarration('a', 'loud' as never), false);
    assert.equal(set.narration('a'), undefined);
  });

  it('文件里的坏覆盖值和已不在托管集的覆盖值读入时被忽略', () => {
    writeFileSync(file, JSON.stringify({ managed: ['a'], narration: { a: 'loud', ghost: 'relay' } }));
    const set = new ManagedSet(file);
    assert.deepEqual(set.list(), ['a']);
    assert.equal(set.narration('a'), undefined);
    assert.equal(set.narration('ghost'), undefined);
    writeFileSync(file, JSON.stringify({ managed: ['a'], narration: ['relay'] }));
    assert.equal(new ManagedSet(file).narration('a'), undefined);
  });

  it('写盘失败时覆盖值只留在内存里并上报错误', () => {
    writeFileSync(join(dir, 'blocked'), 'not a directory');
    const errors: unknown[] = [];
    const set = new ManagedSet(join(dir, 'blocked', 'managed.json'), e => errors.push(e));
    set.add('a');
    assert.equal(set.setNarration('a', 'relay'), true);
    assert.equal(set.narration('a'), 'relay');
    assert.ok(errors.length >= 2);
  });
});
