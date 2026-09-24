import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskLedger, type Task } from '../src/tasks.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
let dir: string;
let file: string;
let time: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jv-tasks-'));
  file = join(dir, 'tasks.json');
  time = DAY;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const ledger = (path = file, onError?: (e: unknown) => void) => new TaskLedger(path, onError, () => time);
const saved = (): Task[] => JSON.parse(readFileSync(file, 'utf8'));
function seed(count: number, status: Task['status'] = 'open'): Task[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `seed-${i}`, session: `session-${i}`, request: '原话', message: '投递',
    createdAt: i, status, rounds: 0,
  }));
}

describe('等价类', () => {
  it('原话只在内存缓存，投递时与消息一起落盘并消费', () => {
    const tasks = ledger();
    tasks.expect('a', '  原话\n');
    assert.equal(existsSync(file), false);
    const task = tasks.open('a', '改写消息');
    assert.match(task.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(task.request, '  原话\n');
    assert.equal(task.message, '改写消息');
    assert.equal(task.createdAt, time);
    assert.equal(task.status, 'open');
    assert.equal(task.rounds, 0);
    assert.deepEqual(ledger().current('a'), task);
    assert.equal(tasks.open('a', '第二次').request, '第二次');
  });

  it('无缓存时回退消息，缓存互不串会话且最后原话覆盖前一条', () => {
    const tasks = ledger();
    tasks.expect('a', '旧原话');
    tasks.expect('a', '新原话');
    tasks.expect('b', '乙原话');
    assert.equal(tasks.open('c', '丙消息').request, '丙消息');
    assert.equal(tasks.open('b', '乙消息').request, '乙原话');
    assert.equal(tasks.open('a', '甲消息').request, '新原话');
  });

  it('重启不恢复尚未投递的原话', () => {
    ledger().expect('a', '临时原话');
    assert.equal(ledger().open('a', '回退消息').request, '回退消息');
  });

  it('状态、裁决和轮次持久化，完成状态不再是 current', () => {
    const tasks = ledger();
    const task = tasks.open('a', '任务');
    tasks.setStatus(task.id, 'judging');
    assert.equal(ledger().current('a')?.status, 'judging');
    const verdict = { verdict: 'unsatisfied' as const, summary: '缺少测试', missing: '测试', at: time };
    tasks.setStatus(task.id, 'unsatisfied', verdict);
    tasks.bumpRound(task.id);
    tasks.bumpRound(task.id);
    assert.deepEqual(ledger().current('a'), { ...task, status: 'unsatisfied', rounds: 2, lastVerdict: verdict });
    tasks.setStatus(task.id, 'done', { verdict: 'satisfied', summary: '完成', at: time });
    assert.equal(tasks.current('a'), undefined);
    assert.equal(saved()[0].lastVerdict?.verdict, 'satisfied');
    assert.equal(saved()[0].rounds, 2);
  });

  it('dropSession 终止所有未完成任务并只清除对应原话', () => {
    const rows = seed(4);
    rows[0].session = rows[1].session = rows[2].session = 'a';
    rows[1].status = 'judging'; rows[2].status = 'unsatisfied';
    writeFileSync(file, JSON.stringify(rows));
    const tasks = ledger();
    tasks.expect('a', '甲原话'); tasks.expect('b', '乙原话');
    tasks.dropSession('a');
    assert.deepEqual(saved().map(t => t.status), ['dropped', 'dropped', 'dropped', 'open']);
    assert.equal(tasks.current('a'), undefined);
    assert.equal(tasks.open('a', '甲回退').request, '甲回退');
    assert.equal(tasks.open('b', '乙改写').request, '乙原话');
  });

  it('新的用户原话替代全部旧未完成任务，包括未满足任务', () => {
    const rows = seed(4);
    for (const row of rows) row.session = 'a';
    rows[1].status = 'judging'; rows[2].status = 'unsatisfied'; rows[3].status = 'done';
    writeFileSync(file, JSON.stringify(rows));
    const tasks = ledger();
    assert.equal(tasks.current('a')?.id, rows[2].id);
    tasks.expect('a', '新的用户需求');
    const first = tasks.open('a', '新任务');
    assert.deepEqual(saved().map(t => t.status), ['dropped', 'dropped', 'dropped', 'done', 'open']);
    const second = tasks.open('a', '更新任务');
    assert.notEqual(first.id, second.id);
    assert.equal(saved().filter(t => t.status === 'open').length, 1);
    assert.equal(tasks.current('a')?.id, second.id);
  });

  it('未满足任务的续做沿用原需求和 id，更新指令并递增轮数', () => {
    const tasks = ledger();
    tasks.expect('a', '原始需求');
    const original = tasks.open('a', '第一轮');
    const verdict = { verdict: 'unsatisfied' as const, summary: '少了测试', missing: '补测试', at: time };
    tasks.setStatus(original.id, 'unsatisfied', verdict);
    time += 100;
    const continued = tasks.open('a', '补充测试');
    assert.deepEqual(continued, { ...original, message: '补充测试', rounds: 1, lastVerdict: verdict });
    assert.equal(saved().length, 1);
    assert.deepEqual(ledger().current('a'), continued);
  });

  it('返回的任务与传入裁决不能从外部修改账本', () => {
    const tasks = ledger();
    const task = tasks.open('a', '原消息');
    const verdict = { verdict: 'unclear' as const, summary: '待查', at: time };
    tasks.setStatus(task.id, 'judging', verdict);
    verdict.summary = '篡改'; task.message = '篡改';
    const snapshot = tasks.current('a')!;
    snapshot.lastVerdict!.summary = '再次篡改'; snapshot.status = 'done';
    assert.equal(tasks.current('a')?.message, '原消息');
    assert.equal(tasks.current('a')?.lastVerdict?.summary, '待查');
    assert.equal(tasks.current('a')?.status, 'judging');
  });
});

describe('边界值', () => {
  it('过期原话不会把续轮误当成新任务，过期任务不能续用', () => {
    const tasks = ledger();
    const first = tasks.open('a', '需求');
    tasks.setStatus(first.id, 'unsatisfied');
    tasks.expect('a', '已过期输入');
    time += 10 * MINUTE;
    assert.equal(tasks.open('a', '续做').id, first.id);
    tasks.setStatus(first.id, 'unsatisfied');
    time += DAY;
    assert.notEqual(tasks.open('a', '新任务').id, first.id);
  });
  it('原话在十分钟前一毫秒有效，恰好十分钟过期', () => {
    const tasks = ledger();
    tasks.expect('a', '有效'); tasks.expect('b', '到期');
    time += 10 * MINUTE - 1;
    assert.equal(tasks.open('a', '改写').request, '有效');
    time += 1;
    assert.equal(tasks.open('b', '回退').request, '回退');
  });

  for (const status of ['open', 'judging', 'unsatisfied'] as const) {
    it(`${status} 在恰好24小时仍有效，超过一毫秒被 current 清理`, () => {
      const tasks = ledger();
      const task = tasks.open('a', '任务');
      tasks.setStatus(task.id, status);
      time += DAY;
      assert.equal(tasks.current('a')?.status, status);
      time += 1;
      assert.equal(tasks.current('a'), undefined);
      assert.equal(saved()[0].status, 'dropped');
    });
  }

  it('启动和显式 prune 会持久化过期清理', () => {
    const tasks = ledger();
    const task = tasks.open('a', '任务');
    tasks.prune(time + DAY + 1);
    assert.equal(saved()[0].status, 'dropped');
    writeFileSync(file, JSON.stringify([task]));
    time += DAY + 1;
    ledger();
    assert.equal(saved()[0].status, 'dropped');
  });

  it('新投递与状态或轮次变更时也会清理其他过期任务', () => {
    for (const action of ['open', 'setStatus', 'bumpRound', 'dropSession'] as const) {
      time = DAY;
      const tasks = ledger();
      const expired = tasks.open('expired', '旧任务');
      time += DAY;
      const fresh = tasks.open('fresh', '新任务');
      time += 1;
      if (action === 'open') tasks.open('third', '第三个');
      else if (action === 'setStatus') tasks.setStatus(fresh.id, 'judging');
      else if (action === 'bumpRound') tasks.bumpRound(fresh.id);
      else tasks.dropSession('fresh');
      assert.equal(saved().find(t => t.id === expired.id)?.status, 'dropped');
    }
  });

  it('第201条优先移除最早关闭任务，保留更早活动任务', () => {
    const rows = seed(200);
    rows[50].status = 'done'; rows[100].status = 'dropped';
    writeFileSync(file, JSON.stringify(rows));
    ledger().open('new', '新任务');
    assert.equal(saved().length, 200);
    assert.equal(saved().some(t => t.id === rows[50].id), false);
    assert.equal(saved().some(t => t.id === rows[0].id), true);
    assert.equal(saved().some(t => t.id === rows[100].id), true);
  });

  it('全部活动时第201条仍遵守硬上限，移除最早活动任务', () => {
    const rows = seed(200);
    writeFileSync(file, JSON.stringify(rows));
    const tasks = ledger();
    const newest = tasks.open('new', '新任务');
    assert.equal(saved().length, 200);
    assert.equal(tasks.current(rows[0].session), undefined);
    assert.equal(tasks.current(rows[1].session)?.id, rows[1].id);
    assert.equal(tasks.current('new')?.id, newest.id);
  });

  it('启动时也修剪超过200条的文件', () => {
    writeFileSync(file, JSON.stringify(seed(202)));
    const tasks = ledger();
    assert.equal(saved().length, 200);
    assert.equal(tasks.current('session-0'), undefined);
    assert.equal(tasks.current('session-1'), undefined);
    assert.equal(tasks.current('session-2')?.id, 'seed-2');
  });

  it('未知 id 不产生变化或写盘，空账本启动不建文件', () => {
    const tasks = ledger();
    tasks.setStatus('missing', 'done'); tasks.bumpRound('missing'); tasks.dropSession('missing');
    assert.equal(tasks.current('missing'), undefined);
    assert.equal(existsSync(file), false);
  });

  it('父目录不存在时原子保存会创建目录并清理临时文件', () => {
    const nested = join(dir, 'a', 'b', 'tasks.json');
    const task = ledger(nested).open('a', '任务');
    assert.deepEqual(JSON.parse(readFileSync(nested, 'utf8')), [task]);
    assert.equal(existsSync(`${nested}.tmp`), false);
  });
});

describe('异常路径', () => {
  for (const raw of ['{bad', 'null', '{}', '42', '[null, 7, {}]']) {
    it(`损坏或无效文件 ${raw} 按空账本处理`, () => {
      writeFileSync(file, raw);
      const tasks = ledger();
      assert.equal(tasks.current('a'), undefined);
      tasks.open('a', '有效');
      assert.equal(saved().length, 1);
    });
  }

  it('验证所有磁盘字段，丢弃非法行并保留合法行', () => {
    const valid = seed(1)[0];
    const bad = [
      { id: '' }, { session: ' ' }, { request: '' }, { message: '\n' },
      { createdAt: '0' }, { createdAt: -1 }, { status: 'other' },
      { rounds: -1 }, { rounds: 0.5 }, { lastVerdict: null },
      { lastVerdict: { verdict: 'bad', summary: '', at: 0 } },
      { lastVerdict: { verdict: 'unclear', summary: 42, at: 0 } },
      { lastVerdict: { verdict: 'unclear', summary: '', at: '0' } },
      { lastVerdict: { verdict: 'unclear', summary: '', at: 0, missing: 42 } },
    ].map((patch, i) => ({ ...valid, id: `bad-${i}`, ...patch }));
    writeFileSync(file, JSON.stringify([valid, ...bad]));
    const tasks = ledger();
    assert.equal(tasks.current(valid.session)?.id, valid.id);
    tasks.open('new', '新任务');
    assert.equal(saved().length, 2);
  });

  it('确定性写盘失败通过 onError 报告，内存仍可继续更新', () => {
    const blocker = join(dir, 'file-not-directory');
    writeFileSync(blocker, 'occupied');
    const errors: unknown[] = [];
    const tasks = ledger(join(blocker, 'tasks.json'), e => errors.push(e));
    const task = tasks.open('a', '任务');
    assert.equal(errors.length, 1);
    assert.deepEqual(tasks.current('a'), task);
    tasks.bumpRound(task.id);
    assert.equal(errors.length, 2);
    assert.equal(tasks.current('a')?.rounds, 1);
    assert.equal(readFileSync(blocker, 'utf8'), 'occupied');
  });

  it('空会话、消息和原话在任何变更前被拒绝，保留已有任务和缓存', () => {
    const tasks = ledger();
    const task = tasks.open('a', '已有任务');
    tasks.expect('a', '待投递原话');
    const before = readFileSync(file, 'utf8');
    for (const blank of ['', ' \n\t']) {
      assert.throws(() => tasks.expect(blank, '原话'), Error);
      assert.throws(() => tasks.expect('a', blank), Error);
      assert.throws(() => tasks.open(blank, '消息'), Error);
      assert.throws(() => tasks.open('a', blank), Error);
      assert.throws(() => tasks.dropSession(blank), Error);
      assert.throws(() => tasks.current(blank), Error);
    }
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal(tasks.current('a')?.id, task.id);
    assert.equal(tasks.open('a', '重试').request, '待投递原话');
  });
});
