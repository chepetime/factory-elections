import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TaskRecord,
  approvalBlockers,
  conflictFollowUpSeen,
  followUpAgent,
  taskCommandBlockers,
} from '../src/index.ts';

const base = TaskRecord.parse({
  id: '6f2c1a52-9b3e-4d1f-8a7c-2e5b9d0c4f11',
  project: 'demo',
  repo: '/r',
  prompt: 'Ship it',
  stage: 'pr-opened',
  worktree: { path: '/w', branch: 'factory/t1', base_branch: 'main' },
  pr: {
    url: 'https://github.com/o/r/pull/1',
    branch: 'factory/t1',
    head_sha: 'h1',
    at: '2026-11-26T10:00:00.000Z',
  },
});

test('only a follow-up continues a task whose PR is open, and it needs that PR', () => {
  assert.deepEqual(taskCommandBlockers(base, 'follow-up'), []);
  for (const action of ['run', 'revise', 'approve', 'open-pr'] as const)
    assert.equal(taskCommandBlockers(base, action)[0]?.code, 'pr-open', action);
  const { pr: _pr, ...noPr } = base;
  assert.equal(taskCommandBlockers(TaskRecord.parse(noPr), 'follow-up')[0]?.code, 'pr-required');
  // During a follow-up the PR stays recorded, and the normal commands work again.
  assert.deepEqual(taskCommandBlockers({ ...base, stage: 'awaiting-approval' }, 'approve'), []);
});

test('approval refuses only the commit the PR already has', () => {
  const task = { ...base, workflow: 'agent' as const, stage: 'awaiting-approval' as const };
  const verified = { ...task, verification: { passed: true, head_sha: 'h2', at: 'x', output_tail: '' } };
  assert.deepEqual(approvalBlockers(verified, 'h2'), []);
  const same = { ...task, verification: { passed: true, head_sha: 'h1', at: 'x', output_tail: '' } };
  assert.deepEqual(approvalBlockers(same, 'h1'), ['the pull request already has this commit']);
});

test('the follow-up agent is the run agent, then the assignee; the watcher adds one per PR head', () => {
  assert.equal(followUpAgent({ ...base, workflow: 'agent', agent: 'devin' }, 'mika'), 'devin');
  assert.equal(followUpAgent(base, 'mika'), 'mika');
  assert.equal(followUpAgent(base), undefined);
  const seen = {
    ...base,
    follow_ups: [
      { at: 'x', kind: 'conflicts' as const, note: 'n', agent: 'devin', by: 'factory', pr_head: 'h1' },
    ],
  };
  assert.equal(conflictFollowUpSeen(seen, 'h1'), true);
  assert.equal(conflictFollowUpSeen(seen, 'h2'), false);
});
