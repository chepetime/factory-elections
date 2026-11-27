import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasWriteAccess,
  isGitHubLogin,
  MAX_TEND_FIXES,
  nextTendAction,
  rollupChecks,
  TendRecord,
  type PrState,
} from '../src/tending.ts';

const pr = (x: Partial<PrState> = {}): PrState => ({
  number: 1,
  url: 'u',
  state: 'OPEN',
  head_sha: 'h1',
  base: 'main',
  mergeable: 'MERGEABLE',
  checks: [],
  threads: [],
  ...x,
});
const record = (x: Record<string, unknown> = {}) => TendRecord.parse({ number: 1, url: 'u', ...x });
const me = { answerThreads: true };

test('tending picks one action: end, conflicts, threads, rerun once, then fix, then stop', () => {
  assert.deepEqual(nextTendAction(pr({ state: 'MERGED' }), record(), me), { kind: 'end', state: 'MERGED' });
  assert.equal(nextTendAction(pr({ mergeable: 'CONFLICTING' }), record(), me).kind, 'merge-base');
  const thread = {
    id: 'th',
    resolved: false,
    outdated: false,
    comments: [{ id: 'c1', author: 'rev', body: 'rename this' }],
  };
  assert.equal(nextTendAction(pr({ threads: [thread] }), record(), me).kind, 'answer-threads');
  assert.equal(
    nextTendAction(pr({ threads: [thread] }), record(), { ...me, answerThreads: false }).kind,
    'wait',
  );
  assert.equal(nextTendAction(pr({ threads: [thread] }), record({ answered: ['th:c1'] }), me).kind, 'wait');
  const failed = { name: 'test', state: 'fail' as const, run_id: '42' };
  assert.equal(nextTendAction(pr({ checks: [failed] }), record(), me).kind, 'rerun');
  assert.equal(nextTendAction(pr({ checks: [failed] }), record({ reruns: ['h1'] }), me).kind, 'fix-ci');
  assert.equal(
    nextTendAction(pr({ checks: [failed, { name: 'b', state: 'pending' }] }), record(), me).kind,
    'wait',
  );
  assert.deepEqual(
    nextTendAction(
      pr({ checks: [failed] }),
      record({ reruns: ['h1'], fixes_since_green: MAX_TEND_FIXES }),
      me,
    ),
    {
      kind: 'stop',
      reason: '3 fixes did not make the PR green',
    },
  );
});

test('status rollups become pass, fail, pending and skipped checks with their run ids', () => {
  assert.deepEqual(
    rollupChecks([
      {
        name: 'unit',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        detailsUrl: 'https://github.com/o/r/actions/runs/123/job/4',
      },
      { name: 'lint', status: 'IN_PROGRESS', conclusion: '' },
      { context: 'ci/legacy', state: 'SUCCESS' },
      { name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
    ]).map((c) => [c.name, c.state, c.run_id ?? null]),
    [
      ['unit', 'fail', '123'],
      ['lint', 'pending', null],
      ['ci/legacy', 'pass', null],
      ['docs', 'skipped', null],
    ],
  );
});

test('only write, maintain and admin access is trusted, and logins are checked before they reach a path', () => {
  assert.equal(hasWriteAccess({ permission: 'admin', role_name: 'admin' }), true);
  assert.equal(hasWriteAccess({ permission: 'write', role_name: 'maintain' }), true);
  assert.equal(hasWriteAccess({ permission: 'write', role_name: 'write' }), true);
  assert.equal(hasWriteAccess({ permission: 'read', role_name: 'maintain' }), true, 'role_name counts too');
  assert.equal(hasWriteAccess({ permission: 'read', role_name: 'triage' }), false);
  assert.equal(hasWriteAccess({ permission: 'none' }), false);
  assert.equal(hasWriteAccess({}), false);
  assert.equal(isGitHubLogin('octo-cat'), true);
  assert.equal(isGitHubLogin('dependabot[bot]'), true);
  for (const bad of ['', 'ghost/../x', 'a b', '-x', 'x?y=1', '../admin'])
    assert.equal(isGitHubLogin(bad), false);
});

const unit = { name: 'unit', state: 'fail' as const, run_id: '42' };
const lint = { name: 'lint', state: 'fail' as const, run_id: '43' };

test('a real failure skips the rerun', () => {
  const action = nextTendAction(pr({ checks: [unit] }), record(), { ...me, verdicts: { unit: 'real' } });
  assert.deepEqual(action, { kind: 'fix-ci', checks: [unit] });
  const mixed = nextTendAction(pr({ checks: [unit, lint] }), record(), { ...me, verdicts: { unit: 'real' } });
  assert.deepEqual(mixed, { kind: 'fix-ci', checks: [unit] }, 'only the real failure is fixed');
});

test('a flake reruns once per SHA and check', () => {
  const flake = { verdicts: { unit: 'flake', lint: 'flake' } as const };
  const first = nextTendAction(pr({ checks: [unit, lint] }), record(), { ...me, ...flake });
  assert.deepEqual(first, { kind: 'rerun', checks: [unit, lint] });
  const afterUnit = record({ ci_retries: [{ sha: 'h1', check: 'unit', verdict: 'flake' }] });
  assert.deepEqual(nextTendAction(pr({ checks: [unit, lint] }), afterUnit, { ...me, ...flake }), {
    kind: 'fix-ci',
    checks: [unit],
  });
  assert.deepEqual(nextTendAction(pr({ checks: [lint] }), afterUnit, { ...me, ...flake }), {
    kind: 'rerun',
    checks: [lint],
  });
  assert.equal(
    nextTendAction(pr({ head_sha: 'h2', checks: [unit] }), afterUnit, { ...me, ...flake }).kind,
    'rerun',
    'a new head gets its own rerun',
  );
});

test('an unknown failure keeps the one rerun, and a failure without a run goes to a fix', () => {
  assert.equal(nextTendAction(pr({ checks: [unit] }), record(), me).kind, 'rerun');
  assert.equal(nextTendAction(pr({ checks: [{ name: 'x', state: 'fail' }] }), record(), me).kind, 'fix-ci');
});

test('a legacy reruns list loads as retries of every check, and the retries stay capped', () => {
  const old = record({ reruns: ['h1'] });
  assert.deepEqual(old.ci_retries, [{ sha: 'h1', check: '*', verdict: 'unknown' }]);
  assert.equal('reruns' in old, false);
  const many = Array.from({ length: 150 }, (_, i) => ({ sha: `s${i}`, check: 'unit', verdict: 'flake' }));
  const capped = record({ ci_retries: many });
  assert.equal(capped.ci_retries.length, 100);
  assert.equal(capped.ci_retries[99]!.sha, 's149');
});

test('a ticket over its cap starts no fix, and waits so a raised cap resumes it', () => {
  const failed = { name: 'ci', state: 'fail' as const };
  const over = { ...me, ticketCapReached: true };
  assert.equal(nextTendAction(pr({ checks: [failed] }), record({ reruns: ['h1'] }), me).kind, 'fix-ci');
  assert.equal(nextTendAction(pr({ checks: [failed] }), record({ reruns: ['h1'] }), over).kind, 'wait');
  assert.equal(nextTendAction(pr({ mergeable: 'CONFLICTING' }), record(), over).kind, 'wait');
});
