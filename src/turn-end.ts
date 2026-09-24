import type { Task } from './tasks.ts';
import { legacyNarration, type Narration } from './narration.ts';

/** Jarvis owns the announcement only for unfinished work it relays. */
export function claimsTurnEnd(input: {
  managed: boolean;
  task?: Pick<Task, 'status'>;
  judgeEnabled: boolean;
  narration?: Narration;
}): boolean {
  const narration = input.narration ?? legacyNarration(input.judgeEnabled);
  return input.managed === true && narration === 'relay'
    && ['open', 'judging', 'unsatisfied'].includes(input.task?.status ?? '');
}
