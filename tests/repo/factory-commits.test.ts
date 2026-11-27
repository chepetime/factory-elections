import { test } from 'node:test';
import assert from 'node:assert/strict';
import { files, read } from './helpers.ts';

// Commits the factory makes (adapters-git, tending) must skip git hooks. The factory runs its
// own checks, and a repository hook (pre-commit lint, post-commit check) must not block or
// slow a commit nobody typed. Matches git argument arrays that contain the 'commit' subcommand.
const sources = files('{packages,apps}/*/src/**/*.ts');
const commitCalls = sources.flatMap((file) =>
  [...read(file).matchAll(/\[[^[\]]*'commit'[^[\]]*\]/g)].map((match) => ({ file, args: match[0] })),
);

test('factory git commit calls are found', () => {
  assert.ok(
    commitCalls.length >= 3,
    `Found ${commitCalls.length} git commit argument arrays in packages/*/src and apps/*/src; expected at least 3 ` +
      '(adapters-git, tending). If the factory commit code moved, update the search in tests/repo/factory-commits.test.ts.',
  );
});

test('every factory git commit passes --no-verify', () => {
  const missing = commitCalls.filter((call) => !call.args.includes("'--no-verify'"));
  assert.deepEqual(
    missing.map((call) => call.file),
    [],
    "Rule: git commits made by the factory pass '--no-verify', so installed git hooks never run on them. " +
      "Fix: add '--no-verify' to the commit arguments in: " +
      missing.map((call) => `${call.file} ${call.args}`).join('; '),
  );
});
