import type { Task } from './tasks.ts';

/** Only unfinished work handed to Jarvis owns the completion announcement. */
export function claimsTurnEnd(input: {
  managed: boolean;
  task?: Pick<Task, 'status'>;
  judgeEnabled: boolean;
}): boolean {
  return input.managed === true && input.judgeEnabled === true
    && ['open', 'judging', 'unsatisfied'].includes(input.task?.status ?? '');
}
