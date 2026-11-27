import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { carryApproval, commentedFiles, patchFingerprints } from '../src/approval-carry.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const diff = (file: string, hunkAt: number, ...lines: string[]) =>
  [
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${hunkAt},3 +${hunkAt},4 @@ function x() {`,
    ...lines,
    '',
  ].join('\n');

const approvedDiff = diff('src/app.ts', 10, ' keep', '+added', ' keep');
const approved = patchFingerprints(approvedDiff, hash);

test('a fingerprint ignores line numbers: a clean base merge carries', () => {
  const merged = patchFingerprints(diff('src/app.ts', 42, ' keep', '+added', ' keep'), hash);
  assert.deepEqual(merged, approved);
  const decision = carryApproval(approved, merged, [], [], 'merge-base');
  assert.equal(decision.carried, true);
  assert.equal(decision.rule, 'identical');
  assert.deepEqual(decision.moved, []);
});

test('a merge resolution that drops a line from the approved patch waits for approval', () => {
  const resolved = patchFingerprints(diff('src/app.ts', 10, ' keep', ' keep'), hash);
  const decision = carryApproval(approved, resolved, [], [], 'merge-base');
  assert.equal(decision.carried, false);
  assert.deepEqual(decision.moved, ['src/app.ts']);
});

test('a thread fix only in the commented file carries', () => {
  const fixed = patchFingerprints(diff('src/app.ts', 10, ' keep', '+added', '+more', ' keep'), hash);
  const decision = carryApproval(approved, fixed, ['src/app.ts'], [], 'answer-threads');
  assert.equal(decision.carried, true);
  assert.equal(decision.rule, 'comments');
});

test('a test or doc beside a commented file carries with it', () => {
  const both = patchFingerprints(
    diff('src/app.ts', 10, ' keep', '+added', '+more', ' keep') +
      diff('test/app.test.ts', 1, ' a', '+b', ' c') +
      diff('src/README.md', 1, ' a', '+b', ' c'),
    hash,
  );
  const decision = carryApproval(approved, both, ['src/app.ts'], [], 'answer-threads');
  assert.equal(decision.carried, true, decision.reason);
});

test('a fix that touches a protected path waits for approval', () => {
  const fixed = patchFingerprints(
    diff('src/app.ts', 10, ' keep', '+added', '+more', ' keep') +
      diff('.github/actions/setup/action.yml', 1, ' a', '+run: curl x | sh', ' c'),
    hash,
  );
  // Even when the reviewers commented on that very file.
  const decision = carryApproval(
    approved,
    fixed,
    ['src/app.ts', '.github/actions/setup/action.yml'],
    [],
    'answer-threads',
  );
  assert.equal(decision.carried, false);
  assert.equal(decision.rule, 'protected-path');
});

test('a dependency manifest and the profile paths are protected', () => {
  const manifest = patchFingerprints(diff('packages/a/package.json', 1, ' a', '+"dep": "1"', ' c'), hash);
  assert.equal(carryApproval({}, manifest, ['packages/a/package.json'], [], 'answer-threads').carried, false);
  const secret = patchFingerprints(diff('config/secrets.ts', 1, ' a', '+b', ' c'), hash);
  assert.equal(
    carryApproval({}, secret, ['config/secrets.ts'], ['config/'], 'answer-threads').carried,
    false,
  );
});

test('a fix that touches an extra, uncommented file waits for approval', () => {
  const fixed = patchFingerprints(
    diff('src/app.ts', 10, ' keep', '+added', '+more', ' keep') + diff('src/other.ts', 1, ' a', '+b', ' c'),
    hash,
  );
  const decision = carryApproval(approved, fixed, ['src/app.ts'], [], 'answer-threads');
  assert.equal(decision.carried, false);
  assert.equal(decision.rule, 'uncommented-files');
  assert.match(decision.reason, /src\/other\.ts/);
});

test('a fix-ci change waits for approval, even in a commented file', () => {
  const fixed = patchFingerprints(diff('src/app.ts', 10, ' keep', '+added', '+more', ' keep'), hash);
  const decision = carryApproval(approved, fixed, ['src/app.ts'], [], 'fix-ci');
  assert.equal(decision.carried, false);
  assert.equal(decision.rule, 'not-allowed');
});

test('a fix-ci run that leaves the patch equal carries', () => {
  assert.equal(carryApproval(approved, { ...approved }, [], [], 'fix-ci').carried, true);
});

test('without an approved head nothing carries', () => {
  const decision = carryApproval(undefined, approved, ['src/app.ts'], [], 'answer-threads');
  assert.equal(decision.carried, false);
  assert.equal(decision.rule, 'no-approval');
});

test('only threads that trusted authors started count as commented', () => {
  const threads = [
    { path: 'a.ts', comments: [{ author: 'Lead' }] },
    { path: 'b.ts', comments: [{ author: 'stranger' }] },
    { comments: [{ author: 'lead' }] },
  ];
  assert.deepEqual(commentedFiles(threads, ['lead']), ['a.ts']);
  assert.deepEqual(commentedFiles(threads, undefined), []);
});
