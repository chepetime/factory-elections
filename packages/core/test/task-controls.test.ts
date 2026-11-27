import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STAGES,
  TaskRecord,
  executionBusy,
  executionPhase,
  taskActions,
  taskCommandBlockers,
} from '../src/index.ts';

const id = '11111111-2222-4333-8444-555555555555';
const task = TaskRecord.parse({
  id,
  project: 'demo',
  repo: '/r',
  prompt: 'Fix it',
  stage: 'awaiting-approval',
  worktree: { path: '/w', branch: `factory/${id}`, base_branch: 'main' },
  verification: { passed: true, head_sha: 'abc1234', at: 'now', output_tail: '' },
  review: { verdict: 'approve', summary: 'ok', findings: [], head_sha: 'abc1234', at: 'now' },
});

test('every durable stage has an explicit run/revision/approval policy', () => {
  const expected = {
    queued: ['run', 'reject'],
    classified: ['run', 'reject'],
    blocked: ['run', 'reject', 'check'],
    coding: ['run', 'reject'],
    'verification-failed': ['run', 'revise', 'reject', 'check'],
    reviewing: ['run', 'reject'],
    'awaiting-approval': ['revise', 'approve', 'reject'],
    approved: ['revise', 'reject', 'open-pr'],
    rejected: ['revise', 'reject'],
    'pr-opened': [],
    failed: ['run', 'revise', 'reject', 'check'],
  };
  for (const stage of STAGES) {
    const current = {
      ...task,
      stage,
      approval: { decision: 'approved' as const, head_sha: 'abc1234', at: 'now' },
    };
    assert.deepEqual(
      taskActions(current, 'idle', 'abc1234')
        .filter((a) => a.allowed)
        .map((a) => a.action),
      expected[stage],
      stage,
    );
  }
});

test('ownership and unavailable observations disable every command even at an approval gate', () => {
  for (const phase of ['queued', 'running', 'finalizing', 'unavailable'] as const) {
    const actions = taskActions(task, phase, 'abc1234');
    assert.ok(actions.every((a) => !a.allowed));
    assert.ok(
      actions.every((a) => a.blockers[0]?.code === (phase === 'unavailable' ? 'unavailable' : 'busy')),
    );
  }
  for (const state of ['completed', 'failed'] as const) {
    assert.equal(executionPhase(state, true), 'finalizing');
    assert.equal(executionBusy(executionPhase(state, true)), true);
    assert.equal(executionPhase(state, false), state);
  }
  assert.equal(executionPhase('running', false), 'interrupted');
  assert.equal(executionPhase('queued', false), 'interrupted');
  assert.equal(executionPhase(undefined, false), 'idle');
  assert.equal(executionPhase('queued', true), 'queued');
  assert.equal(executionPhase('running', true), 'running');
});

test('discovery binds gates to the observed commit and advertises human inputs', () => {
  const approve = (head?: string) =>
    taskActions(task, 'completed', head).find((a) => a.action === 'approve')!;
  assert.equal(approve('abc1234').allowed, true);
  assert.deepEqual(approve('abc1234').requires, ['head']);
  assert.equal(approve('different').blockers[0]?.code, 'gate');
  assert.equal(approve().blockers[0]?.code, 'head-unavailable');
  const findings = [{ severity: 'blocking' as const, message: 'needs attention' }];
  assert.deepEqual(
    taskActions({ ...task, review: { ...task.review!, findings } }, 'completed', 'abc1234').find(
      (a) => a.action === 'approve',
    )?.requires,
    ['head', 'accept_blocking'],
  );
  const approved = {
    ...task,
    stage: 'approved' as const,
    approval: { decision: 'approved' as const, head_sha: 'older', at: 'now' },
  };
  assert.equal(
    taskActions(approved, 'completed', 'abc1234').find((a) => a.action === 'open-pr')?.allowed,
    false,
  );
});

test('missing worktrees and published tasks cannot accidentally unlock mutations', () => {
  assert.equal(taskCommandBlockers({ ...task, worktree: undefined }, 'revise')[0]?.code, 'worktree-required');
  assert.ok(taskActions({ ...task, stage: 'pr-opened' }, 'completed', 'abc1234').every((a) => !a.allowed));
});
