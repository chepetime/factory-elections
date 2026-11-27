import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RepoProfile } from '@factory/core';
import { worktreeGuard } from '../src/support.ts';

const profile = { confirmed: { forbidden_paths: [], forbidden_commands: [] } } as unknown as RepoProfile;

test('the coder guard refuses a base merge, rebase or pull, and says the factory does it', () => {
  const guard = worktreeGuard('/w', profile);
  assert.match(
    guard.check('Bash', { command: 'git merge main' }) ?? '',
    /not allowed: The factory keeps this branch current/,
  );
  assert.match(
    guard.check('Bash', { command: 'git status && git pull --rebase' }) ?? '',
    /"git pull --rebase" is not allowed/,
  );
  assert.equal(guard.check('Bash', { command: 'git diff origin/main...HEAD' }), undefined);
});
