// Lockfile conflicts are the factory's to resolve: it regenerates the lockfile, outside the sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as git from '@factory/adapters-git';
import { runShell } from '@factory/adapters-process';
import { mergeBase } from '../src/merge-conflicts.ts';

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A repository whose `feature` and `main` both changed the lockfile (and maybe another file). */
async function diverged(alsoConflict: boolean) {
  const repo = await mkdtemp(join(tmpdir(), 'factory-merge-'));
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.name', 't');
  sh(repo, 'config', 'user.email', 't@example.com');
  await writeFile(join(repo, 'package.json'), '{"name":"x","version":"1.0.0","private":true}\n');
  await writeFile(join(repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n# base\n");
  await writeFile(join(repo, 'notes.md'), 'base\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'base');
  sh(repo, 'switch', '-qc', 'feature');
  await writeFile(join(repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n# feature\n");
  if (alsoConflict) await writeFile(join(repo, 'notes.md'), 'feature\n');
  sh(repo, 'commit', '-qam', 'feature');
  sh(repo, 'switch', '-q', 'main');
  await writeFile(join(repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n# main\n");
  if (alsoConflict) await writeFile(join(repo, 'notes.md'), 'main\n');
  sh(repo, 'commit', '-qam', 'main');
  sh(repo, 'switch', '-q', 'feature');
  return repo;
}

const deps = { git, shell: { runShell }, log: () => {} };

test('a lockfile-only conflict is regenerated and the merge committed, with nothing for the agent', async () => {
  const repo = await diverged(false);
  const merge = await mergeBase(deps, repo, 'main');
  assert.deepEqual(merge, { clean: true, conflicted: [], regenerated: ['pnpm-lock.yaml'] });
  const lock = await readFile(join(repo, 'pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(lock, /^(<<<<<<<|>>>>>>>)/m);
  assert.match(lock, /lockfileVersion/);
  assert.equal(sh(repo, 'status', '--porcelain').trim(), '');
  assert.match(sh(repo, 'log', '-1', '--format=%P'), / /, 'the merge commit has two parents');
});

test('with other conflicts, the lockfile is resolved and staged, and only the others go to the agent', async () => {
  const repo = await diverged(true);
  const merge = await mergeBase(deps, repo, 'main');
  assert.deepEqual(merge, { clean: false, conflicted: ['notes.md'], regenerated: ['pnpm-lock.yaml'] });
  assert.match(sh(repo, 'diff', '--name-only', '--cached'), /pnpm-lock\.yaml/);
  assert.doesNotMatch(await readFile(join(repo, 'pnpm-lock.yaml'), 'utf8'), /^<<<<<<</m);
});
