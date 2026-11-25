import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClassifierVerdict,
  LoopDefinition,
  ModelLadder,
  TaskRecord,
  approvalBlockers,
  isForbiddenCommand,
  isForbiddenPath,
  isGeneratedPath,
  openPrBlockers,
  readinessDecision,
  type RepoProfile,
} from '../src/index.ts';

const id = '11111111-2222-4333-8444-555555555555';
const base = { id, project: 'demo', repo: '/tmp/repo', prompt: 'Fix it', stage: 'queued' } as const;

test('verdict readiness must follow blocker priority', () => {
  const ok = ClassifierVerdict.safeParse({
    intake_id: id,
    kind: 'code',
    loe: 'S',
    readiness: 'needs-research',
    blockers: [
      { kind: 'slicing', question: 'a' },
      { kind: 'research', question: 'b' },
    ],
  });
  assert.equal(ok.success, true);
  const bad = ClassifierVerdict.safeParse({
    intake_id: id,
    kind: 'code',
    loe: 'S',
    readiness: 'ready',
    blockers: [{ kind: 'clarification', question: 'q' }],
  });
  assert.equal(bad.success, false);
});

test('readiness maps to actions, unsupported wins', () => {
  const v = ClassifierVerdict.parse({
    intake_id: id,
    kind: 'code',
    loe: 'S',
    readiness: 'ready',
    blockers: [],
  });
  assert.deepEqual(readinessDecision(v), { action: 'continue' });
  assert.deepEqual(readinessDecision({ ...v, kind: 'unsupported' }), { action: 'unsupported' });
  assert.deepEqual(
    readinessDecision({
      ...v,
      readiness: 'needs-clarification',
      blockers: [{ kind: 'clarification', question: 'q' }],
    }),
    { action: 'ask-human' },
  );
});

test('code loops must keep the review and approval gates in order', () => {
  const entries = [
    { kind: 'step', name: 'coder' },
    { kind: 'gate', name: 'verify' },
    { kind: 'step', name: 'reviewer' },
    { kind: 'gate', name: 'human-review' },
    { kind: 'gate', name: 'decisions-clear' },
    { kind: 'gate', name: 'open-pr' },
  ];
  assert.equal(LoopDefinition.safeParse({ name: 'code', produces_code: true, entries }).success, true);
  const skipped = entries.filter((e) => e.name !== 'human-review');
  assert.equal(
    LoopDefinition.safeParse({ name: 'code', produces_code: true, entries: skipped }).success,
    false,
  );
  assert.equal(
    LoopDefinition.safeParse({ name: 'code', produces_code: true, entries: [...entries].reverse() }).success,
    false,
  );
});

test('ladder rungs need claude models and unique names', () => {
  const rung = { name: 'a', model: 'claude-sonnet-5-5', effort: 'high' };
  assert.equal(ModelLadder.safeParse({ name: 'l', rungs: [rung] }).success, true);
  assert.equal(ModelLadder.safeParse({ name: 'l', rungs: [rung, rung] }).success, false);
  assert.equal(ModelLadder.safeParse({ name: 'l', rungs: [{ ...rung, model: 'gpt-5' }] }).success, false);
});

test('pull request requires approval bound to the current commit', () => {
  const now = '2026-01-01T00:00:00Z';
  const task = TaskRecord.parse({
    ...base,
    stage: 'approved',
    worktree: { path: '/w', branch: `factory/${id}`, base_branch: 'main' },
    verification: { passed: true, head_sha: 'abc', at: now, output_tail: '' },
    review: { verdict: 'approve', summary: 'ok', findings: [], head_sha: 'abc', at: now },
    approval: { decision: 'approved', head_sha: 'abc', at: now },
  });
  assert.deepEqual(openPrBlockers(task, 'abc'), []);
  assert.ok(openPrBlockers(task, 'def').length > 0);
  assert.ok(openPrBlockers({ ...task, approval: undefined }, 'abc').some((r) => r.includes('approved')));
  assert.ok(
    approvalBlockers({ ...task, verification: { ...task.verification!, passed: false } }, 'abc').length > 0,
  );
});

test('an agent run needs verification but no reviewer before approval', () => {
  const now = '2026-01-01T00:00:00Z';
  const task = TaskRecord.parse({
    ...base,
    stage: 'awaiting-approval',
    worktree: { path: '/w', branch: `factory/${id}`, base_branch: 'main' },
    verification: { passed: true, head_sha: 'abc', at: now, output_tail: '' },
  });
  assert.ok(
    approvalBlockers(task, 'abc').some((r) => r.includes('reviewer')),
    'the pipeline needs a review',
  );
  assert.deepEqual(approvalBlockers({ ...task, workflow: 'agent' }, 'abc'), []);
  assert.ok(
    approvalBlockers({ ...task, workflow: 'agent', verification: undefined }, 'abc').some((r) =>
      r.includes('verification'),
    ),
  );
});

test('forbidden paths and commands', () => {
  assert.equal(isForbiddenPath('secrets/key.pem', ['secrets/']), true);
  assert.equal(isForbiddenPath('src/env.txt', ['src/*.env', '.env']), false);
  assert.equal(isForbiddenPath('.env', ['.env']), true);
  assert.equal(isForbiddenPath('infra/prod.tf', ['infra/*.tf']), true);
  const profile = {
    confirmed: { forbidden_paths: [], forbidden_commands: ['terraform apply'] },
  } as unknown as RepoProfile;
  assert.equal(isForbiddenCommand('git  push origin', profile), 'git push');
  assert.equal(isForbiddenCommand('cd x && terraform apply', profile), 'terraform apply');
  assert.equal(isForbiddenCommand('pnpm test', profile), undefined);
});

test('generated output is recognised anywhere in the tree, deliberate files are not', () => {
  for (const path of [
    'apps/web/tsconfig.tsbuildinfo',
    'apps/web/.next/server/app.js',
    'node_modules/x/index.js',
    'coverage/lcov.info',
    'docs/.DS_Store',
  ])
    assert.equal(isGeneratedPath(path), true, path);
  for (const path of ['src/next.ts', 'docs/coverage.md', 'packages/x/dist-notes.md', 'tsconfig.json'])
    assert.equal(isGeneratedPath(path), false, path);
});

test('profile generated paths match files and directory descendants only', () => {
  assert.equal(isGeneratedPath('dist/app.js', ['dist/']), true);
  assert.equal(isGeneratedPath('generated.ts', ['./generated.ts']), true);
  assert.equal(isGeneratedPath('dist-other/app.js', ['dist/']), false);
});
