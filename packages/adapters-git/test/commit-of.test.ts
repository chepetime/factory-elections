import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitOf } from '../src/index.ts';

test('commitOf gives the commit a ref points at, and undefined for no ref or a missing one', async (t) => {
  const repo = await mkdtemp(join(tmpdir(), 'factory-commit-of-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  await writeFile(join(repo, 'README.md'), '# test\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  assert.equal(await commitOf(repo, 'main'), git('rev-parse', 'HEAD'));
  assert.equal(await commitOf(repo, 'no-such-branch'), undefined);
  assert.equal(await commitOf(repo, undefined), undefined);
});
