import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyFlake, type FlakeHistory } from '../src/ci-flake.ts';

const check = { name: 'unit' };
const none: FlakeHistory = { passed_on_head: [], flaky_checks: [], base_merge_on_green: false };

test('a pass of the same check on the same SHA is a flake', () => {
  assert.deepEqual(
    classifyFlake(check, { ...none, passed_on_head: ['unit'] }, 'AssertionError: x'),
    { verdict: 'flake', evidence: 'same-sha-pass' },
    'it beats every log signature',
  );
});

test('a check on the known-flaky list is a flake', () => {
  assert.deepEqual(classifyFlake(check, { ...none, flaky_checks: ['unit'] }, undefined), {
    verdict: 'flake',
    evidence: 'known-flaky',
  });
});

test('an assertion signature is a real failure', () => {
  for (const log of [
    'AssertionError [ERR_ASSERTION]: expected 1 to equal 2',
    'src/a.ts(3,1): error TS2322: bad type',
    'not ok 4 - renders',
  ])
    assert.deepEqual(classifyFlake(check, none, log), { verdict: 'real', evidence: 'assertion' }, log);
});

test('an infra signature is a flake', () => {
  for (const log of [
    'Error: connect ETIMEDOUT 10.0.0.1:443',
    'read ECONNRESET',
    'The runner has lost communication with the server',
    'Process completed with exit code 143.',
  ])
    assert.deepEqual(classifyFlake(check, none, log), { verdict: 'flake', evidence: 'infra' }, log);
});

test('a failure on a base merge into a green head is a flake', () => {
  assert.deepEqual(classifyFlake(check, { ...none, base_merge_on_green: true }, 'unreadable output'), {
    verdict: 'flake',
    evidence: 'base-merge-on-green',
  });
});

test('unknown is not a flake', () => {
  for (const log of [undefined, '', 'something failed']) {
    const result = classifyFlake(check, none, log);
    assert.deepEqual(result, { verdict: 'unknown', evidence: 'none' });
    assert.notEqual(result.verdict, 'flake');
  }
});

test('an assertion beats an infra signature', () => {
  assert.deepEqual(classifyFlake(check, none, 'AssertionError: expected 200\nlater: read ECONNRESET'), {
    verdict: 'real',
    evidence: 'assertion',
  });
});
