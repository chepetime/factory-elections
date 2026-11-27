// Lockfile conflicts are the factory's to resolve: it regenerates the lockfile in the check sandbox.
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

// The check sandbox is macOS only and refuses to run elsewhere (CI is Linux); these tests cover the
// merge, and one test below checks what the lockfile tool is given.
const deps = {
  git,
  shell: {
    runShell: (command: string, options: Parameters<typeof runShell>[1]) =>
      runShell(command, { ...options, sandbox: undefined }),
  },
  log: () => {},
};

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

test('the lockfile tool runs in the check sandbox with the check environment, and git runs outside it', async (t) => {
  process.env.FACTORY_TEST_STORAGE_KEY = 'backend-only-secret';
  t.after(() => void delete process.env.FACTORY_TEST_STORAGE_KEY);
  const repo = await diverged(false);
  const calls: { command: string; env?: NodeJS.ProcessEnv; sandbox?: { reopen?: readonly string[] } }[] = [];
  const shell = {
    runShell: (command: string, options: Parameters<typeof runShell>[1] = {}) => {
      calls.push({ command, env: options.env, sandbox: options.sandbox });
      return runShell(command, { ...options, sandbox: undefined });
    },
  };
  await mergeBase({ ...deps, shell }, repo, 'main');
  const tool = calls.find((c) => c.command.startsWith('pnpm install'));
  assert.ok(tool, 'the lockfile tool ran');
  assert.match(tool.command, /--ignore-scripts --ignore-pnpmfile/);
  assert.deepEqual(tool.sandbox?.reopen, [repo]);
  assert.equal(tool.env?.FACTORY_TEST_STORAGE_KEY, undefined);
  for (const call of calls.filter((c) => c !== tool)) {
    assert.match(call.command, /^git /);
    assert.equal(call.sandbox, undefined, 'git writes the main repository, outside the sandbox');
  }
});
