import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { push, remoteHead } from '../src/index.ts';

async function fixture(t: { after(fn: () => unknown): void }) {
  const base = await mkdtemp(join(tmpdir(), 'factory-push-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const origin = join(base, 'origin.git');
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, repo], { stdio: 'pipe' });
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  await writeFile(join(repo, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-qm', 'one');
  git('checkout', '-qb', 'factory/t1');
  return { repo, origin, git };
}

test('push sends the given SHA to refs/heads/<branch>, not the branch tip, and remoteHead reads it back', async (t) => {
  const { repo, origin, git } = await fixture(t);
  const approved = git('rev-parse', 'HEAD');
  assert.equal(await remoteHead(repo, 'factory/t1'), undefined, 'no ref before the push');
  // A commit lands after the SHA was checked.
  await writeFile(join(repo, 'a.txt'), 'two\n');
  git('commit', '-qam', 'later');
  const tip = git('rev-parse', 'HEAD');
  assert.notEqual(tip, approved);

  await push(repo, approved, 'factory/t1');

  const onOrigin = execFileSync('git', ['ls-remote', origin, 'refs/heads/factory/t1']).toString();
  assert.equal(onOrigin.split('\t')[0], approved);
  assert.equal(await remoteHead(repo, 'factory/t1'), approved);
  assert.equal(git('config', 'branch.factory/t1.remote'), 'origin');
  assert.equal(git('config', 'branch.factory/t1.merge'), 'refs/heads/factory/t1');
});

test('push is never forced: a non-fast-forward is rejected and the remote ref stays', async (t) => {
  const { repo, git } = await fixture(t);
  const first = git('rev-parse', 'HEAD');
  await push(repo, first, 'factory/t1');
  await writeFile(join(repo, 'a.txt'), 'two\n');
  git('commit', '-qam', 'two');
  const second = git('rev-parse', 'HEAD');
  await push(repo, second, 'factory/t1');
  // Pushing the older commit would rewind the remote branch.
  await assert.rejects(push(repo, first, 'factory/t1'));
  assert.equal(await remoteHead(repo, 'factory/t1'), second);
});
