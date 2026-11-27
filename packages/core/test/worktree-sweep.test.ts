import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idleHours, worktreeVerdict, type WorktreeFacts } from '../src/worktree-sweep.ts';

const now = new Date('2026-11-27T12:00:00.000Z');
const old = '2026-11-25T12:00:00.000Z';
const base: WorktreeFacts = {
  stage: 'rejected',
  updated_at: old,
  exists: true,
  dirty: false,
  unpushed_commits: 0,
  agent_running: false,
};

test('removes an idle rejected task', () => {
  assert.deepEqual(worktreeVerdict(base, now), { action: 'remove' });
});
test('removes archived tasks and tasks whose PR merged or closed', () => {
  for (const extra of [{ archived: true }, { pr: 'merged' as const }, { pr: 'closed' as const }])
    assert.deepEqual(worktreeVerdict({ ...base, stage: 'coding', ...extra }, now), { action: 'remove' });
});
test('keeps a task still in progress, or with an open PR', () => {
  assert.deepEqual(worktreeVerdict({ ...base, stage: 'coding' }, now), {
    action: 'keep',
    reason: 'not-finished',
  });
  assert.deepEqual(worktreeVerdict({ ...base, stage: 'pr-opened', pr: 'open' }, now), {
    action: 'keep',
    reason: 'not-finished',
  });
});
test('keeps a worktree younger than N hours, and honors a custom N', () => {
  const recent = { ...base, updated_at: '2026-11-27T00:00:00.000Z' };
  assert.deepEqual(worktreeVerdict(recent, now), { action: 'keep', reason: 'not-idle-yet' });
  assert.deepEqual(worktreeVerdict(recent, now, 6), { action: 'remove' });
});
test('keeps a task with no usable timestamp', () => {
  assert.deepEqual(worktreeVerdict({ ...base, updated_at: undefined }, now), {
    action: 'keep',
    reason: 'not-idle-yet',
  });
});
test('keeps a task with no worktree', () => {
  assert.deepEqual(worktreeVerdict({ ...base, exists: false }, now), {
    action: 'keep',
    reason: 'no-worktree',
  });
});
test('reports, and does not remove, uncommitted changes', () => {
  assert.deepEqual(worktreeVerdict({ ...base, dirty: true }, now), {
    action: 'report',
    reason: 'uncommitted-changes',
  });
});
test('reports unpushed commits', () => {
  assert.deepEqual(worktreeVerdict({ ...base, unpushed_commits: 2 }, now), {
    action: 'report',
    reason: 'unpushed-commits',
  });
});
test('reports a running agent first', () => {
  assert.deepEqual(worktreeVerdict({ ...base, agent_running: true, dirty: true }, now), {
    action: 'report',
    reason: 'agent-running',
  });
});
test('idleHours falls back to 24 for anything but a positive number', () => {
  assert.equal(idleHours(6), 6);
  for (const v of [0, -1, NaN, '5', undefined]) assert.equal(idleHours(v), 24);
});
