import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environmentFailure } from '../src/index.ts';

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
