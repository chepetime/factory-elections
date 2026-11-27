import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSandbox } from '@factory/core';
import { sandboxFor } from '../src/index.ts';

test('the coder sandbox and the check sandbox read the same shared rules', () => {
  const extra = { allowed_domains: ['x.example.com'], allow_write: ['/w'] };
  const coder = sandboxFor('edit', '/home/me', extra);
  const check = checkSandbox('/home/me', '/work', extra);
  assert.deepEqual(check.denyRead, coder?.filesystem?.denyRead);
  assert.deepEqual(check.allowedDomains, coder?.network?.allowedDomains);
  // The check also writes in its worktree; everything else is the coder's list.
  assert.equal(check.allowWrite[0], '/work');
  assert.deepEqual(check.allowWrite.slice(1), coder?.filesystem?.allowWrite);
});

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
  assert.deepEqual(sandbox?.filesystem?.denyRead, [
    '/home/me/.ssh',
    '/home/me/.npmrc',
    '/home/me/.aws',
    '/home/me/.config/gh',
    '/home/me/Library/Keychains',
  ]);
  const locks = /^\/(private\/)?tmp\/pnpm-store-operation-locks-\d+$/;
  for (const path of sandbox?.filesystem?.allowWrite ?? [])
    assert.ok(path.startsWith('/home/me/') || locks.test(path), path);
});

test("pnpm 12 can take its store lock, which lives in /tmp, not the user's temp folder", () => {
  const writes = sandboxFor('edit', '/home/me')?.filesystem?.allowWrite ?? [];
  const uid = process.getuid?.() ?? 0;
  assert.ok(writes.includes(`/private/tmp/pnpm-store-operation-locks-${uid}`));
  assert.ok(writes.includes(`/tmp/pnpm-store-operation-locks-${uid}`));
});

test('profile sandbox additions extend defaults', () => {
  const sandbox = sandboxFor('edit', '/home/me', {
    allowed_domains: ['registry.example.com'],
    allow_write: ['/tmp/cache'],
  });
  assert.deepEqual(sandbox?.network?.allowedDomains, ['registry.npmjs.org', 'registry.example.com']);
  assert.ok(sandbox?.filesystem?.allowWrite?.includes('/tmp/cache'));
});
