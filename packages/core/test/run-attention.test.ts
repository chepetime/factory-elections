import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FEATURE_STAGE_LABELS,
  FeatureStage,
  STAGES,
  runAttention,
  runNeed,
  stageLabel,
} from '../src/index.ts';

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

test('every stage and every feature stage has a label for a person', () => {
  for (const stage of STAGES) assert.ok(stageLabel(stage), stage);
  for (const stage of FeatureStage.options) assert.ok(FEATURE_STAGE_LABELS[stage], stage);
  assert.equal(stageLabel('verification-failed'), 'Checks failed');
  assert.equal(stageLabel('pr-opened'), 'PR opened');
});
