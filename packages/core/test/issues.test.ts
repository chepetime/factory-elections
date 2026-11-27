import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Stage } from '../src/index.ts';
import {
  defaultPrefix,
  dropAction,
  queueWaitLabel,
  Issue,
  IssueBoard,
  issueKey,
  issueNumber,
  ProjectSettings,
  runHeld,
  runWorking,
  statusFromStage,
  syncedStatus,
} from '../src/index.ts';

test('keys join the prefix and number, and the number parses back from any prefix', () => {
  assert.equal(issueKey('CE', 12), 'CE-12');
  assert.equal(issueNumber('CE-12'), 12);
  assert.equal(issueNumber('old-7'), 7);
  assert.equal(issueNumber('12'), undefined);
  assert.equal(issueNumber('CE-'), undefined);
  assert.equal(issueNumber('3a8e7c1e-0000-4000-8000-000000000000'), undefined);
});

test('the default prefix uses the name initials, or the first letters of a single word', () => {
  assert.equal(defaultPrefix('change-elections'), 'CE');
  assert.equal(defaultPrefix('factory'), 'FAC');
  assert.equal(defaultPrefix('my_big_new_web_app_x'), 'MBNWA');
  assert.equal(defaultPrefix('a'), 'AX');
  assert.equal(defaultPrefix('9lives'), 'P9LI');
  for (const name of ['change-elections', 'factory', 'a', '9lives', 'x-1'])
    assert.match(defaultPrefix(name), /^[A-Z][A-Z0-9]{1,4}$/);
});

test('settings accept a valid prefix, an empty one, or none, and refuse the rest', () => {
  assert.equal(ProjectSettings.parse({ prefix: 'CE' }).prefix, 'CE');
  assert.equal(ProjectSettings.parse({ prefix: '' }).prefix, '');
  assert.equal(ProjectSettings.parse({}).prefix, undefined);
  for (const bad of ['C', 'ce', '1CE', 'TOOLONG', 'C-E'])
    assert.throws(() => ProjectSettings.parse({ prefix: bad }));
});

test('run stages map to board columns', () => {
  assert.equal(statusFromStage('queued'), 'todo');
  assert.equal(statusFromStage('coding'), 'in_progress');
  assert.equal(statusFromStage('awaiting-approval'), 'in_review');
  // An open PR is still in review; the merge moves the task to Done (IssueService.prOutcome).
  assert.equal(statusFromStage('pr-opened'), 'in_review');
  assert.equal(statusFromStage('approved'), 'in_review');
  assert.equal(statusFromStage('verification-failed'), 'blocked');
  assert.equal(statusFromStage('rejected'), 'cancelled');
});

test('the run sets the status only when it changed after the status was last set', () => {
  const issue = { status: 'backlog' as const, status_at: '2026-11-20T10:00:00.000Z' };
  assert.equal(syncedStatus(issue), 'backlog');
  assert.equal(
    syncedStatus(issue, { stage: 'coding', updated_at: '2026-11-20T11:00:00.000Z' }),
    'in_progress',
  );
  assert.equal(
    syncedStatus(issue, { stage: 'pr-opened', updated_at: '2026-11-20T09:00:00.000Z' }),
    'backlog',
  );
  assert.equal(syncedStatus(issue, { stage: 'coding' }), 'in_progress');
});

test('drops start, run or stop work only through In progress and Cancelled', () => {
  assert.deepEqual(dropAction('todo', 'todo'), { kind: 'none' });
  assert.deepEqual(dropAction('backlog', 'todo'), { kind: 'set-status', status: 'todo' });
  assert.deepEqual(dropAction('backlog', 'in_progress'), { kind: 'start-run' });
  assert.deepEqual(dropAction('cancelled', 'in_progress', { stage: 'rejected' }), { kind: 'start-run' });
  assert.deepEqual(dropAction('blocked', 'in_progress', { stage: 'failed' }), { kind: 'run' });
  assert.deepEqual(dropAction('todo', 'in_progress', { stage: 'queued' }), { kind: 'run' });
  assert.equal(dropAction('in_review', 'in_progress', { stage: 'awaiting-approval' }).kind, 'refused');
  assert.deepEqual(dropAction('in_progress', 'cancelled', { stage: 'coding' }), { kind: 'reject' });
  assert.deepEqual(dropAction('done', 'cancelled', { stage: 'pr-opened' }), {
    kind: 'set-status',
    status: 'cancelled',
  });
  assert.deepEqual(dropAction('backlog', 'cancelled'), { kind: 'set-status', status: 'cancelled' });
});

test('drops never skip the approval gate or override an open run', () => {
  assert.equal(dropAction('in_review', 'done', { stage: 'awaiting-approval' }).kind, 'refused');
  assert.equal(dropAction('in_progress', 'todo', { stage: 'coding' }).kind, 'refused', 'a working run stays');
  assert.equal(dropAction('todo', 'backlog', { stage: 'queued' }).kind, 'refused');
  assert.equal(dropAction('done', 'todo', { stage: 'approved' }).kind, 'refused');
  assert.equal(dropAction('todo', 'in_review').kind, 'refused');
  assert.equal(dropAction('todo', 'blocked').kind, 'refused');
  assert.deepEqual(dropAction('done', 'backlog', { stage: 'pr-opened' }), {
    kind: 'set-status',
    status: 'backlog',
  });
});

test('an issue parses with defaults for its optional lists', () => {
  const issue = Issue.parse({
    number: 1,
    title: 'Add a staging link',
    status: 'backlog',
    status_at: '2026-11-20T10:00:00.000Z',
    created_at: '2026-11-20T10:00:00.000Z',
    updated_at: '2026-11-20T10:00:00.000Z',
  });
  assert.deepEqual([issue.description, issue.priority, issue.runs, issue.comments], ['', 'none', [], []]);
});

test('a board parses without deleted runs, and only coding and reviewing count as working', () => {
  assert.deepEqual(IssueBoard.parse({ next: 1, items: [] }).deleted_runs, []);
  assert.equal(runWorking('coding'), true);
  assert.equal(runWorking('reviewing'), true);
  for (const stage of ['queued', 'awaiting-approval', 'failed', 'pr-opened'] as const)
    assert.equal(runWorking(stage), false);
});

test('a run that waits for you closes when you send its task back to the queue', () => {
  assert.deepEqual(dropAction('blocked', 'todo', { stage: 'blocked' }), { kind: 'requeue', status: 'todo' });
  assert.deepEqual(dropAction('blocked', 'backlog', { stage: 'failed' }), {
    kind: 'requeue',
    status: 'backlog',
  });
  assert.deepEqual(dropAction('in_review', 'todo', { stage: 'awaiting-approval' }), {
    kind: 'requeue',
    status: 'todo',
  });
  assert.deepEqual(dropAction('blocked', 'todo', { stage: 'verification-failed' }), {
    kind: 'requeue',
    status: 'todo',
  });
});

test('a queued turn shows in Todo, unless a person cancelled the task since', () => {
  const run = { stage: 'blocked' as const, updated_at: '2026-11-20T10:00:00.000Z', waiting: true };
  assert.equal(syncedStatus({ status: 'in_progress', status_at: '2026-11-20T11:00:00.000Z' }, run), 'todo');
  assert.equal(syncedStatus({ status: 'backlog', status_at: '2026-11-20T09:00:00.000Z' }, run), 'todo');
  assert.equal(
    syncedStatus({ status: 'cancelled', status_at: '2026-11-20T11:00:00.000Z' }, run),
    'cancelled',
  );
});

test('a queued turn refuses every drop but Cancelled, so no drop closes its run or starts a second turn', () => {
  const run = { stage: 'blocked' as const, waiting: true };
  for (const to of ['backlog', 'in_progress', 'done'] as const)
    assert.equal(dropAction('todo', to, run).kind, 'refused', to);
  assert.deepEqual(dropAction('todo', 'cancelled', run), { kind: 'reject' });
  assert.deepEqual(dropAction('todo', 'todo', run), { kind: 'none' });
});

test('a run is held by a live run when that is known, else by a working stage', () => {
  assert.equal(runHeld('coding'), true);
  assert.equal(runHeld('failed'), false);
  assert.equal(runHeld('coding', false), false, 'an interrupted run is not held');
  assert.equal(runHeld('failed', true), true, 'a live revision of a failed run is held');
});

test('a queued turn names what it waits for', () => {
  assert.equal(queueWaitLabel('agent', 'Devin'), 'Waiting for Devin');
  assert.equal(queueWaitLabel('agent'), 'Waiting for its agent');
  assert.equal(queueWaitLabel('slot', 'Devin'), 'Waiting for a free slot', 'a full pool is not the agent');
});

test('a Done task whose PR is open asks for a follow-up when dropped on In progress; a rejected one starts again', () => {
  assert.deepEqual(dropAction('done', 'in_progress', { stage: 'pr-opened' }), { kind: 'follow-up' });
  assert.deepEqual(dropAction('cancelled', 'in_progress', { stage: 'rejected' }), { kind: 'start-run' });
});

test('blockers: FE-22 waits for FE-21 until it is Done, and a cycle or unknown key is refused', async () => {
  const { blockerGate, blockedByProblems, openBlockers } = await import('../src/index.ts');
  const items = [
    { key: 'FE-20', status: 'done' as const, blocked_by: [] },
    { key: 'FE-21', status: 'in_review' as const, blocked_by: ['FE-20'], run: { id: 'run-21' } },
    { key: 'FE-23', status: 'todo' as const, blocked_by: [] },
  ];
  // Keys match by number, so a changed prefix still finds the blocker; a deleted one no longer blocks.
  assert.deepEqual(openBlockers(['fe-21', 'FE-20', 'FE-99'], items), ['FE-21']);
  assert.deepEqual(
    blockerGate([], items, () => undefined),
    { kind: 'ready' },
  );
  assert.deepEqual(
    blockerGate(['FE-20'], items, () => undefined),
    { kind: 'ready' },
  );
  // One blocker without an open PR: wait.
  assert.deepEqual(
    blockerGate(['FE-21'], items, () => undefined),
    { kind: 'wait', open: ['FE-21'] },
  );
  const record = (stage: Stage, pr?: object) =>
    ({ id: 'run-21', stage, ...(pr ? { pr } : {}), worktree: { branch: 'factory/run-21' } }) as never;
  assert.deepEqual(
    blockerGate(['FE-21'], items, () => record('awaiting-approval')),
    { kind: 'wait', open: ['FE-21'] },
  );
  // One blocker whose latest run has an open PR: start now, stacked on its branch.
  assert.deepEqual(
    blockerGate(['FE-21'], items, () => record('pr-opened', { number: 7, url: 'u' })),
    { kind: 'stack', key: 'FE-21', branch: 'factory/run-21' },
  );
  // Several blockers: wait until all are Done, even when one has an open PR.
  assert.deepEqual(
    blockerGate(['FE-21', 'FE-23'], items, () => record('pr-opened', { number: 7, url: 'u' })),
    { kind: 'wait', open: ['FE-21', 'FE-23'] },
  );
  assert.deepEqual(blockedByProblems(items), []);
  assert.deepEqual(blockedByProblems([...items, { key: 'FE-24', blocked_by: ['FE-24'] }]), [
    'FE-24 blocks itself',
  ]);
  assert.deepEqual(blockedByProblems([...items, { key: 'FE-24', blocked_by: ['FE-9'] }]), [
    'FE-24 is blocked by unknown ticket FE-9',
  ]);
  const cycle = items.map((i) => (i.key === 'FE-20' ? { ...i, blocked_by: ['FE-21'] } : i));
  assert.deepEqual(blockedByProblems(cycle), ['blocking cycle: FE-20 → FE-21 → FE-20']);
});

test('moving a ticket with open blockers to In progress is refused and names them', () => {
  const refused = dropAction('todo', 'in_progress', undefined, ['FE-21', 'FE-23']);
  assert.equal(refused.kind, 'refused');
  assert.match(refused.kind === 'refused' ? refused.reason : '', /FE-21, FE-23/);
  assert.deepEqual(dropAction('todo', 'in_progress', undefined, []), { kind: 'start-run' });
  // Other moves do not care about blockers.
  assert.deepEqual(dropAction('todo', 'backlog', undefined, ['FE-21']), {
    kind: 'set-status',
    status: 'backlog',
  });
});

test('an Issue without blockers reads as blocked by none', () => {
  const at = '2026-11-26T00:00:00.000Z';
  const issue = Issue.parse({
    number: 1,
    title: 'T',
    status: 'todo',
    status_at: at,
    created_at: at,
    updated_at: at,
  });
  assert.deepEqual(issue.blocked_by, []);
});
