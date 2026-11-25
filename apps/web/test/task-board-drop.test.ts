import { describe, expect, it } from 'vitest';
import { dropAction } from '@factory/core';
import { optimisticStatus } from '@/components/task-board';

describe('board drops', () => {
  it('shows a moved card in the column the backend will put it in', () => {
    // Moving a task whose run waits for you back to Todo closes the run and lands in Todo.
    const requeue = dropAction('blocked', 'todo', { stage: 'blocked' });
    expect(requeue).toEqual({ kind: 'requeue', status: 'todo' });
    expect(optimisticStatus(requeue as Exclude<typeof requeue, { kind: 'none' | 'refused' }>)).toBe('todo');
    expect(optimisticStatus({ kind: 'requeue', status: 'backlog' })).toBe('backlog');
    expect(optimisticStatus({ kind: 'set-status', status: 'done' })).toBe('done');
    expect(optimisticStatus({ kind: 'reject' })).toBe('cancelled');
    expect(optimisticStatus({ kind: 'start-run' })).toBe('in_progress');
    expect(optimisticStatus({ kind: 'run' })).toBe('in_progress');
  });
});
