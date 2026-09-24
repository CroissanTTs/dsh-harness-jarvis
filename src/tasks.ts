import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Task {
  id: string;
  session: string;
  request: string;
  message: string;
  createdAt: number;
  status: 'open' | 'judging' | 'done' | 'unsatisfied' | 'dropped';
  rounds: number;
  lastVerdict?: {
    verdict: 'satisfied' | 'unsatisfied' | 'unclear';
    summary: string;
    missing?: string;
    at: number;
  };
}

const EXPECTATION_TTL = 10 * 60_000;
const TASK_TTL = 24 * 60 * 60_000;
const MAX_TASKS = 200;
const unfinished = (task: Task): boolean => ['open', 'judging', 'unsatisfied'].includes(task.status);
const snapshot = (task: Task): Task => ({ ...task, ...(task.lastVerdict ? { lastVerdict: { ...task.lastVerdict } } : {}) });

/** Persisted task history; pending user wording stays in memory until delivery.
 * Write failures report through onError while preserving this run's state. */
export class TaskLedger {
  private readonly file: string;
  private readonly onError: (e: unknown) => void;
  private readonly now: () => number;
  private tasks: Task[];
  private readonly expectations = new Map<string, { request: string; at: number }>();

  constructor(file: string, onError: (e: unknown) => void = () => {}, now: () => number = Date.now) {
    this.file = file;
    this.onError = onError;
    this.now = now;
    this.tasks = readTasks(file);
    this.prune(now());
  }

  expect(session: string, request: string): void {
    requireText(session, 'session'); requireText(request, 'request');
    const now = this.now();
    this.prune(now);
    this.expectations.set(session, { request, at: now });
  }

  open(session: string, message: string): Task {
    requireText(session, 'session'); requireText(message, 'message');
    const now = this.now();
    this.pruneMemory(now);
    const expected = this.expectations.get(session);
    this.expectations.delete(session);
    for (const task of this.tasks) {
      if (task.session === session && unfinished(task)) task.status = 'dropped';
    }
    const task: Task = {
      id: randomUUID(), session, request: expected?.request ?? message,
      message, createdAt: now, status: 'open', rounds: 0,
    };
    this.tasks.push(task);
    this.pruneMemory(now);
    this.save();
    return snapshot(task);
  }

  current(session: string): Task | undefined {
    requireText(session, 'session');
    this.prune(this.now());
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const task = this.tasks[i];
      if (task.session === session && unfinished(task)) return snapshot(task);
    }
    return undefined;
  }

  setStatus(id: string, status: Task['status'], verdict?: Task['lastVerdict']): void {
    const task = this.tasks.find(task => task.id === id);
    if (!task) return;
    task.status = status;
    if (verdict) task.lastVerdict = { ...verdict };
    this.pruneMemory(this.now());
    this.save();
  }

  /** Only count a round here. Continuation policy belongs to the judge layer. */
  bumpRound(id: string): void {
    const task = this.tasks.find(task => task.id === id);
    if (!task) return;
    task.rounds += 1;
    this.pruneMemory(this.now());
    this.save();
  }

  dropSession(session: string): void {
    requireText(session, 'session');
    this.expectations.delete(session);
    let changed = this.pruneMemory(this.now());
    for (const task of this.tasks) {
      if (task.session === session && unfinished(task)) {
        task.status = 'dropped';
        changed = true;
      }
    }
    if (changed) this.save();
  }

  prune(now: number = this.now()): void {
    if (this.pruneMemory(now)) this.save();
  }

  private pruneMemory(now: number): boolean {
    let changed = false;
    for (const [session, expected] of this.expectations) {
      if (now - expected.at >= EXPECTATION_TTL) this.expectations.delete(session);
    }
    for (const task of this.tasks) {
      // Every unfinished state expires, so judging/unsatisfied cannot live forever.
      if (unfinished(task) && now - task.createdAt > TASK_TTL) {
        task.status = 'dropped';
        changed = true;
      }
    }
    while (this.tasks.length > MAX_TASKS) {
      const closed = this.tasks.filter(task => !unfinished(task));
      const candidates = closed.length ? closed : this.tasks;
      const oldest = candidates.reduce((a, b) => a.createdAt <= b.createdAt ? a : b);
      // Hard cap fallback: drop and evict oldest active work if no closed rows remain.
      if (unfinished(oldest)) oldest.status = 'dropped';
      this.tasks.splice(this.tasks.indexOf(oldest), 1);
      changed = true;
    }
    return changed;
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.tasks, null, 2));
      renameSync(tmp, this.file);
    } catch (e) { this.onError(e); }
  }
}

function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must not be blank`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false;
  if (![value.id, value.session, value.request, value.message].every(isText)) return false;
  if (!isTime(value.createdAt) || !Number.isInteger(value.rounds) || (value.rounds as number) < 0) return false;
  if (!['open', 'judging', 'done', 'unsatisfied', 'dropped'].includes(value.status as string)) return false;
  if (value.lastVerdict !== undefined) {
    const verdict = value.lastVerdict;
    if (!isRecord(verdict) || !['satisfied', 'unsatisfied', 'unclear'].includes(verdict.verdict as string)) return false;
    if (typeof verdict.summary !== 'string' || !isTime(verdict.at)) return false;
    if (verdict.missing !== undefined && typeof verdict.missing !== 'string') return false;
  }
  return true;
}

function readTasks(file: string): Task[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw.filter(isTask) : [];
  } catch { return []; }
}
