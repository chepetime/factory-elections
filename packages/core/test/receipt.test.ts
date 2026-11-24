import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, prBody, receiptClaims, type TaskRecord } from '../src/index.ts';

const head = 'a'.repeat(40);
const base = {
  id: 't',
  project: 'p',
  repo: '/r',
  prompt: 'x',
  stage: 'awaiting-approval',
} as unknown as TaskRecord;
const status = (claims: ReturnType<typeof receiptClaims>) =>
  Object.fromEntries(claims.map((c) => [c.id, c.status]));

test('claims are proven only by evidence for the exact commit', () => {
  assert.deepEqual(status(receiptClaims(base, head)), {
    checks: 'not-proven',
    review: 'not-proven',
    approved: 'not-proven',
    ci: 'not-proven',
    deployed: 'not-proven',
  });
  const verified = {
    ...base,
    verification: {
      passed: true,
      head_sha: head,
      at: 't',
      output_tail: '',
      test_integrity: 'checked',
      not_run_locally: ['full check'],
    },
    review: {
      verdict: 'request-changes',
      summary: '',
      findings: [{ severity: 'blocking', message: 'm' }],
      head_sha: head,
      at: 't',
    },
  } as unknown as TaskRecord;
  const s = status(receiptClaims(verified, head));
  assert.equal(s.checks, 'proven');
  assert.equal(s['tests-intact'], 'proven');
  assert.equal(s['not-run:full check'], 'not-proven');
  assert.equal(s.review, 'failed');
  assert.equal(
    status(receiptClaims(verified, 'b'.repeat(40))).checks,
    'not-proven',
    'another commit proves nothing',
  );
  const allowed = {
    ...verified,
    verification: { ...verified.verification!, test_integrity: 'allowed' },
  } as TaskRecord;
  assert.equal(status(receiptClaims(allowed, head))['tests-intact'], 'not-proven');
});

test('the PR body carries the receipt, and canonical JSON ignores key order', () => {
  assert.match(
    prBody(base, head),
    /### Evidence receipt[\s\S]*\*\*NOT PROVEN\*\* CI on the pull request passes/,
  );
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
});
