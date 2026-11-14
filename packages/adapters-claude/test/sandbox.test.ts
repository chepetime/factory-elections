import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sandboxFor } from '../src/index.ts';

test('steps without Bash run without a sandbox', () => {
  assert.equal(sandboxFor('none'), undefined);
  assert.equal(sandboxFor('read-only'), undefined);
});

test('the coder runs Bash in a sandbox it cannot leave and that keeps the guard in the loop', () => {
  const sandbox = sandboxFor('edit', '/home/me');
  assert.equal(sandbox?.enabled, true);
  assert.equal(sandbox?.failIfUnavailable, true);
  assert.equal(sandbox?.autoAllowBashIfSandboxed, false);
  assert.equal(sandbox?.allowUnsandboxedCommands, false);
  assert.deepEqual(sandbox?.network?.allowedDomains, ['registry.npmjs.org']);
  for (const path of sandbox?.filesystem?.allowWrite ?? []) assert.ok(path.startsWith('/home/me/'));
});
