import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTestPath, testWeakening } from '../src/index.ts';

const diff = (path: string, body: string, deleted = false) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    deleted ? '+++ /dev/null' : `+++ b/${path}`,
    '@@ -1 +1 @@',
    body,
  ].join('\n');

test('test paths are found by directory and file name', () => {
  for (const p of ['src/a.test.ts', 'tests/x.py', 'pkg/__tests__/y.js', 'a_test.go', 'spec/z_spec.rb'])
    assert.ok(isTestPath(p), p);
  for (const p of ['src/testing-utils.ts', 'src/contest.ts']) assert.ok(!isTestPath(p), p);
});

test('a change that only adds or keeps tests is not weakening', () => {
  assert.deepEqual(testWeakening(diff('src/a.test.ts', '+  expect(sum(1, 2)).toBe(3);')), []);
  assert.deepEqual(testWeakening(diff('src/a.test.ts', '-  expect(a).toBe(1);\n+  expect(a).toBe(2);')), []);
  assert.deepEqual(
    testWeakening(diff('src/a.ts', '-  assert(x)\n+  return x')),
    [],
    'source files do not count',
  );
  assert.deepEqual(testWeakening(diff('src/a.test.ts', "-it.skip('x', () => {})\n+it('x', () => {})")), []);
});

test('deleted test files, skip and focus markers, and removed assertions are weakening', () => {
  assert.deepEqual(testWeakening(diff('src/a.test.ts', '-  expect(1)', true)), [
    'deletes the test file src/a.test.ts',
  ]);
  for (const marker of [
    "it.skip('x', f)",
    "test.only('x', f)",
    "xit('x', f)",
    '@pytest.mark.skip',
    't.Skip("flaky")',
    "test('x', { skip: true }, f)",
  ])
    assert.equal(testWeakening(diff('tests/a.test.ts', `+${marker}`)).length, 1, marker);
  assert.deepEqual(
    testWeakening(
      diff('src/a.test.ts', '-  expect(a).toBe(1);\n-  expect(b).toBe(2);\n+  expect(a).toBe(1);'),
    ),
    ['removes 1 assertion line(s) in src/a.test.ts'],
  );
});
