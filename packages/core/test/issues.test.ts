import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultPrefix,
  dropAction,
  Issue,
  IssueBoard,
  issueKey,
  issueNumber,
  ProjectSettings,
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
  assert.equal(statusFromStage('pr-opened'), 'done');
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
