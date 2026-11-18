// Parallel tasks share one repository: its administrative git commands must not overlap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addWorktree, exclusive, worktreePaths } from '../src/index.ts';

test('commands on one repository run one at a time, and a failure does not block the next', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-git-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@example.com');
  await writeFile(join(repo, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-qm', 'init');

  let inside = 0;
  let overlap = false;
  const step = (fail: boolean) =>
    exclusive(repo, async () => {
      overlap ||= ++inside > 1;
      await new Promise((done) => setTimeout(done, 20));
      inside--;
      if (fail) throw new Error('boom');
      return 'ok';
    });
  const results = await Promise.allSettled([step(false), step(true), step(false)]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'rejected', 'fulfilled'],
  );
  assert.equal(overlap, false);

  await Promise.all(
    [1, 2, 3, 4, 5].map((n) => addWorktree(repo, join(base, `wt-${n}`), `factory/${n}`, 'main')),
  );
  assert.equal((await worktreePaths(repo)).length, 6);
});
