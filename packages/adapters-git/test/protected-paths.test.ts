import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedPathsSince, commit, headSha, mergeRef, push } from '../src/index.ts';

async function repoWithRemote(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(join(tmpdir(), 'factory-protected-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  const remote = join(base, 'remote.git');
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  await mkdir(join(repo, '.github', 'workflows'), { recursive: true });
  await writeFile(join(repo, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  await writeFile(join(repo, 'old.txt'), 'old\n');
  await writeFile(join(repo, 'README.md'), '# test\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  git('remote', 'add', 'origin', remote);
  return { repo, git };
}

test('changedPathsSince lists both paths of a rename, and deleted paths', async (t) => {
  const { repo, git } = await repoWithRemote(t);
  git('switch', '-qc', 'feature');
  git('mv', '.github/workflows/ci.yml', 'ci.yml');
  git('rm', '-q', 'old.txt');
  await writeFile(join(repo, 'new.txt'), 'new\n');
  git('add', '.');
  git('commit', '-qm', 'change');
  const paths = await changedPathsSince(repo, 'main');
  assert.deepEqual([...paths].sort(), ['.github/workflows/ci.yml', 'ci.yml', 'new.txt', 'old.txt']);
});

test('publication push does not run a pre-push hook from the worktree', async (t) => {
  const { repo, git } = await repoWithRemote(t);
  const marker = join(repo, 'hook-ran');
  // Husky and similar tools point core.hooksPath at a folder the repository itself carries.
  await mkdir(join(repo, '.husky'), { recursive: true });
  await writeFile(join(repo, '.husky', 'pre-push'), `#!/bin/sh\ntouch '${marker}'\n`);
  await chmod(join(repo, '.husky', 'pre-push'), 0o755);
  git('config', 'core.hooksPath', '.husky');
  git('switch', '-qc', 'feature');
  await writeFile(join(repo, 'feature.txt'), 'x\n');
  git('add', 'feature.txt');
  await commit(repo, 'feature');
  // Control: a plain git push does run the hook, so the test would notice a hook that fires.
  git('push', '-q', 'origin', 'feature:control');
  assert.equal(existsSync(marker), true);
  await rm(marker);
  await push(repo, await headSha(repo), 'feature');
  assert.equal(existsSync(marker), false);
});

test('merge does not run the repository hooks either', async (t) => {
  const { repo, git } = await repoWithRemote(t);
  const marker = join(repo, 'merge-hook-ran');
  await mkdir(join(repo, '.githooks'), { recursive: true });
  await writeFile(join(repo, '.githooks', 'post-merge'), `#!/bin/sh\ntouch '${marker}'\n`);
  await chmod(join(repo, '.githooks', 'post-merge'), 0o755);
  git('config', 'core.hooksPath', '.githooks');
  git('switch', '-qc', 'feature');
  await writeFile(join(repo, 'feature.txt'), 'x\n');
  git('add', 'feature.txt');
  await commit(repo, 'feature');
  git('switch', '-q', 'main');
  await writeFile(join(repo, 'main.txt'), 'y\n');
  git('add', 'main.txt');
  await commit(repo, 'main');
  git('switch', '-q', 'feature');
  assert.deepEqual(await mergeRef(repo, 'main'), { clean: true, conflicted: [] });
  assert.equal(existsSync(marker), false);
  // Control: the same merge by plain git runs the hook.
  git('reset', '-q', '--hard', 'HEAD~1');
  git('-c', 'user.useConfigOnly=false', 'merge', '--no-edit', '-q', 'main');
  assert.equal(existsSync(marker), true);
});
