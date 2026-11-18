import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardProblems, startableTickets, Ticket } from '../src/index.ts';

const t = (id: string, blocked_by: string[] = [], over: Partial<Ticket> = {}): Ticket =>
  Ticket.parse({
    id,
    title: `Ticket ${id}`,
    description: 'd',
    acceptance: ['a'],
    blocked_by,
    size: 'S',
    ...over,
  });

test('a board has no unknown blockers, self-blocks, duplicates or cycles', () => {
  assert.deepEqual(boardProblems([t('T1'), t('T2', ['T1'])]), []);
  assert.deepEqual(boardProblems([t('T1', ['T9'])]), ['T1 is blocked by unknown ticket T9']);
  assert.deepEqual(boardProblems([t('T1', ['T1'])]), ['T1 blocks itself']);
  assert.deepEqual(boardProblems([t('T1'), t('T1')]), ['T1 appears twice']);
  assert.match(
    boardProblems([t('T1', ['T3']), t('T2', ['T1']), t('T3', ['T2'])])[0]!,
    /blocking cycle: T1 → T3 → T2 → T1/,
  );
});

test('tickets start when their blockers are done; one blocker stacks, several wait for a merge', () => {
  const board = (tickets: Ticket[]) => startableTickets({ tickets }, (task) => `factory/${task}`);
  const fresh = [t('T1'), t('T2', ['T1']), t('T3'), t('T4', ['T1', 'T3'])];
  assert.deepEqual(
    board(fresh).map((s) => s.ticket.id),
    ['T1', 'T3'],
  );
  const done = (x: Ticket) => ({ ...x, state: 'done' as const, task_id: `task-${x.id}` });
  const after = [
    done(fresh[0]!),
    fresh[1]!,
    done(fresh[2]!),
    { ...fresh[3]!, state: 'waiting-merge' as const },
  ];
  assert.deepEqual(
    board(after).map((s) => [s.ticket.id, s.stackOn]),
    [['T2', 'factory/task-T1']],
  );
  after[3] = { ...after[3]!, blockers_merged_at: 'now' };
  assert.deepEqual(
    board(after).map((s) => [s.ticket.id, s.stackOn]),
    [
      ['T2', 'factory/task-T1'],
      ['T4', undefined],
    ],
  );
});
