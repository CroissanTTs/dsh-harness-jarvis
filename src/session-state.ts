import type { Task } from './tasks.ts';

export interface SessionTask {
  status: 'open' | 'judging' | 'unsatisfied';
  summary?: string;
}

export interface SessionRow {
  id: string;
  title: string;
  status: string;
  unread: boolean;
  managed: boolean;
  workspace?: string;
  task?: SessionTask;
}

/** The panel only receives unfinished task progress, never the full ledger record. */
export function sessionRow(row: Omit<SessionRow, 'task'>,
  task?: Pick<Task, 'status' | 'request' | 'lastVerdict'>): SessionRow {
  switch (task?.status) {
    case 'open':
    case 'judging':
    case 'unsatisfied': {
      const missing = task.lastVerdict?.missing;
      const summary = typeof missing === 'string' && missing.trim() ? missing
        : typeof task.request === 'string' ? Array.from(task.request).slice(0, 30).join('') : '';
      return { ...row, task: { status: task.status, ...(summary ? { summary } : {}) } };
    }
    default: return { ...row };
  }
}
