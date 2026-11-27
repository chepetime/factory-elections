import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearStaleGitLocks, stageAll } from '../src/index.ts';

type Cleanup = { after: (fn: () => Promise<void>) => void };

/** A repository with a linked worktree on branch `task`. */
async function repoWithWorktree(t: Cleanup) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'factory-locks-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  const worktree = join(base, 'task');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'user.email', 'test@example.com');
  await writeFile(join(repo, 'README.md'), '# test\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'worktree', 'add', '-q', '-b', 'task', worktree);
  return {
    repo,
    worktree,
    gitDir: git(worktree, 'rev-parse', '--absolute-git-dir'),
    common: join(repo, '.git'),
  };
}

/** Writes a lock whose mtime is `ageMs` before now. */
async function lock(path: string, ageMs: number) {
  await writeFile(path, '');
  const at = new Date(Date.now() - ageMs);
  await utimes(path, at, at);
}

const never = async () => false;
const options = { branch: 'task', olderThan: Date.now() - 60_000, liveGit: never };

test('a stale index.lock in the worktree git dir is removed, so git add works again', async (t) => {
  const { worktree, gitDir } = await repoWithWorktree(t);
  await lock(join(gitDir, 'index.lock'), 3_600_000);
  await writeFile(join(worktree, 'new.txt'), 'new\n');
  await assert.rejects(stageAll(worktree), /File exists/);
  const report = await clearStaleGitLocks(worktree, options);
  assert.deepEqual(report.removed, [join(gitDir, 'index.lock')]);
  assert.equal(existsSync(join(gitDir, 'index.lock')), false);
  assert.deepEqual(await stageAll(worktree), ['new.txt']);
});

test('the other own locks go too: HEAD, ORIG_HEAD and the task branch ref', async (t) => {
  const { worktree, gitDir, common } = await repoWithWorktree(t);
  const own = [
    join(gitDir, 'HEAD.lock'),
    join(gitDir, 'ORIG_HEAD.lock'),
    join(common, 'refs', 'heads', 'task.lock'),
  ];
  for (const path of own) await lock(path, 3_600_000);
  const report = await clearStaleGitLocks(worktree, options);
  assert.deepEqual([...report.removed].sort(), [...own].sort());
  for (const path of own) assert.equal(existsSync(path), false);
});

test('a lock newer than the threshold stays', async (t) => {
  const { worktree, gitDir } = await repoWithWorktree(t);
  await lock(join(gitDir, 'index.lock'), 1_000);
  const report = await clearStaleGitLocks(worktree, options);
  assert.deepEqual(report.removed, []);
  assert.equal(existsSync(join(gitDir, 'index.lock')), true);
  assert.deepEqual(report.kept, [
    { path: join(gitDir, 'index.lock'), reason: 'newer than the backend start' },
  ]);
});

test('a lock stays while the probe reports a live git process in the worktree', async (t) => {
  const { worktree, gitDir } = await repoWithWorktree(t);
  await lock(join(gitDir, 'index.lock'), 3_600_000);
  const asked: string[] = [];
  const report = await clearStaleGitLocks(worktree, {
    ...options,
    liveGit: async (dir) => {
      asked.push(dir);
      return true;
    },
  });
  assert.deepEqual(asked, [worktree]);
  assert.deepEqual(report.removed, []);
  assert.equal(existsSync(join(gitDir, 'index.lock')), true);
  assert.equal(report.kept[0]?.reason, 'a git process is running');
});

test('a lock stays when the probe cannot tell', async (t) => {
  const { worktree, gitDir } = await repoWithWorktree(t);
  await lock(join(gitDir, 'index.lock'), 3_600_000);
  const report = await clearStaleGitLocks(worktree, {
    ...options,
    liveGit: async () => {
      throw new Error('lsof missing');
    },
  });
  assert.deepEqual(report.removed, []);
  assert.equal(existsSync(join(gitDir, 'index.lock')), true);
  assert.match(report.kept[0]?.reason ?? '', /lsof missing/);
});

test('locks outside the task are reported, never removed', async (t) => {
  const { worktree, repo, common } = await repoWithWorktree(t);
  const foreign = [
    join(common, 'packed-refs.lock'),
    join(common, 'config.lock'),
    join(common, 'index.lock'),
    join(common, 'refs', 'heads', 'main.lock'),
  ];
  for (const path of foreign) await lock(path, 3_600_000);
  const report = await clearStaleGitLocks(worktree, options);
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.reported, [...foreign].sort());
  for (const path of foreign) assert.equal(existsSync(path), true, `${path} in ${repo} was removed`);
});
