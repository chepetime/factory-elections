import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAGES, runAttention, runNeed } from '../src/index.ts';

test('every stage has one answer for who moves next', () => {
  assert.deepEqual(Object.fromEntries(STAGES.map((stage) => [stage, runAttention(stage)])), {
    queued: 'waiting',
    classified: 'waiting',
    blocked: 'needs-you',
    coding: 'working',
    'verification-failed': 'needs-you',
    reviewing: 'working',
    'awaiting-approval': 'needs-you',
    approved: 'needs-you',
    rejected: 'closed',
    'pr-opened': 'done',
    failed: 'needs-you',
  });
});

test('live ownership wins over the stage', () => {
  assert.equal(runAttention('failed', true), 'working', 'a revision of a failed run works');
  assert.equal(runAttention('queued', true), 'working');
  assert.equal(runAttention('coding', false), 'needs-you', 'an interrupted run does not spin');
  assert.equal(runNeed('coding', false), 'interrupted');
  assert.equal(runAttention('queued', false), 'waiting');
  assert.equal(runAttention('pr-opened', true), 'done');
  assert.equal(runNeed('approved'), 'open PR');
  assert.equal(runAttention('blocked', true, true), 'waiting', 'a queued turn waits for its agent');
  assert.equal(runNeed('blocked', false, true), undefined);
  assert.equal(runNeed('coding'), undefined);
});
