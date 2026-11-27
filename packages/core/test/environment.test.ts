import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  environmentFailure,
  ladderStopFailure,
  prBody,
  TaskRecord,
  tooBroadForLocalCheck,
} from '../src/index.ts';

test('known machine faults in check output are environment failures', () => {
  const cases: [string, RegExp][] = [
    ['Error: connect ECONNREFUSED 127.0.0.1:5432', /not reachable/],
    ['client error (Connect): tunnel error: unsuccessful', /not reachable/],
    ['getaddrinfo ENOTFOUND registry.example.com', /not reachable/],
    ['aws: [ERROR]: Error when retrieving token from sso: Token has expired', /credential/],
    ['Unable to locate credentials. You can configure credentials by running "aws configure".', /credential/],
    [
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
      /Docker/,
    ],
    ['ENOSPC: no space left on device, write', /disk/],
    [
      'test:changed: this diff affects 9 workspaces (limit 6), too broad to run on this machine.',
      /too broad/,
    ],
  ];
  for (const [output, reason] of cases) {
    const found = environmentFailure(output);
    assert.ok(found, `expected an environment failure for: ${output}`);
    assert.match(found.reason, reason);
    assert.ok(output.includes(found.line.trim()), 'the matching line is returned');
  }
});

test('ordinary test and type failures are not environment failures', () => {
  for (const output of [
    'AssertionError: expected 2 to equal 3',
    "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    '[test exited with status 1]',
  ])
    assert.equal(environmentFailure(output), undefined, output);
});

test('a profile can add its own environment patterns', () => {
  const found = environmentFailure('mdm sandbox is down for maintenance', ['sandbox is down']);
  assert.equal(found?.reason, 'the output matches the profile pattern /sandbox is down/');
  assert.equal(environmentFailure('all good', ['sandbox is down']), undefined);
});

test('a check that refuses a change as too broad is found by its line', () => {
  assert.equal(
    tooBroadForLocalCheck('ok\ntest:changed: 80 workspaces (limit 6), too broad to run on this machine.\n'),
    'test:changed: 80 workspaces (limit 6), too broad to run on this machine.',
  );
  assert.equal(tooBroadForLocalCheck('AssertionError: expected 2 to equal 3'), undefined);
});

test('the pull request record names the checks that CI must run', () => {
  const task = TaskRecord.parse({
    id: '11111111-2222-4333-8444-555555555555',
    project: 'demo',
    repo: '/r',
    prompt: 'Update dependencies',
    stage: 'awaiting-approval',
    verification: {
      passed: true,
      head_sha: 'abc123abc123abc',
      at: '2026-11-18T00:00:00.000Z',
      output_tail: '',
      not_run_locally: ['test', 'full_check'],
    },
  });
  assert.match(
    prBody(task, 'abc123abc123abc'),
    /Verification: passed at `abc123abc123`; not run locally \(too broad for the workstation\): test, full_check\. CI must pass before merge\./,
  );
});

test('setup failures stop the ladder but are not environment failures', () => {
  const cases: [string, RegExp][] = [
    ['sh: pnpm: command not found', /setup/],
    ['ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile"', /setup/],
  ];
  for (const [output, reason] of cases) {
    assert.equal(environmentFailure(output), undefined, output);
    assert.match(ladderStopFailure(output)?.reason ?? '', reason);
  }
  assert.equal(ladderStopFailure('AssertionError: expected 2 to equal 3'), undefined);
});
