import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worstPerFile } from './complexity-ratchet.mjs';

const d = (filename, n) => ({
  filename,
  message: `function \`f\` has a complexity of ${n}. Maximum allowed is 15.`,
});

test('worstPerFile keeps the highest score per production file', () => {
  const worst = worstPerFile([
    d('packages/a/src/x.ts', 20),
    d('packages/a/src/x.ts', 31),
    d('packages/a/src/y.ts', 16),
  ]);
  assert.deepEqual(worst, { 'packages/a/src/x.ts': 31, 'packages/a/src/y.ts': 16 });
});

test('worstPerFile ignores tests and unrelated diagnostics', () => {
  const worst = worstPerFile([
    d('packages/a/test/x.test.ts', 40),
    { filename: 'packages/a/src/z.ts', message: 'unused' },
  ]);
  assert.deepEqual(worst, {});
});
