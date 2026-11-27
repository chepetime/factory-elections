import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('.', import.meta.url));
const cleanEnv = { ...process.env };
for (const name of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete cleanEnv[name];

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'factory-hooks-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: cleanEnv, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  return { dir, git };
}

test('pre-commit fails a staged file with a lint error and passes a clean one', () => {
  const { dir, git } = repo();
  const run = () =>
    spawnSync(process.execPath, [join(scripts, 'run-pre-commit.mjs')], {
      cwd: dir,
      env: cleanEnv,
      encoding: 'utf8',
    });
  writeFileSync(join(dir, 'clean.mjs'), 'export const a = 1;\n');
  git('add', 'clean.mjs');
  assert.equal(run().status, 0, run().stderr);
  writeFileSync(join(dir, 'bad.mjs'), 'debugger;\n');
  git('add', 'bad.mjs');
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /oxlint failed/);
});

test('pre-commit checks the staged content, not the working copy', () => {
  const { dir, git } = repo();
  const run = () =>
    spawnSync(process.execPath, [join(scripts, 'run-pre-commit.mjs')], {
      cwd: dir,
      env: cleanEnv,
      encoding: 'utf8',
    });
  // Clean staged, broken unstaged edit: passes.
  writeFileSync(join(dir, 'a.mjs'), 'export const a = 1;\n');
  git('add', 'a.mjs');
  writeFileSync(join(dir, 'a.mjs'), 'debugger;\n');
  assert.equal(run().status, 0, run().stderr);
  // Broken staged, clean working copy: fails.
  writeFileSync(join(dir, 'b.mjs'), 'debugger;\n');
  git('add', 'b.mjs');
  writeFileSync(join(dir, 'b.mjs'), 'export const b = 1;\n');
  assert.equal(run().status, 1);
});

test('post-commit records failed for a broken commit and checks the commit tree, not unstaged edits', () => {
  const { dir, git } = repo();
  const root = mkdtempSync(join(tmpdir(), 'factory-root-'));
  const env = {
    ...cleanEnv,
    FACTORY_ROOT: root,
    FACTORY_MAIN_CHECK_NO_INSTALL: '1',
    FACTORY_MAIN_CHECK_COMMAND: 'node check.mjs',
  };
  const check = () => {
    const result = spawnSync(process.execPath, [join(scripts, 'run-post-commit.mjs'), '--foreground'], {
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(join(root, 'logs', 'main-checks.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
  };
  // Commit a broken check; the working tree is fixed but unstaged, so only the commit tree is broken.
  writeFileSync(join(dir, 'check.mjs'), 'process.exit(1);\n');
  git('add', '.');
  git('commit', '-m', 'break the check', '--no-verify');
  writeFileSync(join(dir, 'check.mjs'), 'process.exit(0);\n');
  let results = check();
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, 'failed');
  assert.equal(results[0].sha, git('rev-parse', 'HEAD'));
  assert.equal(results[0].failedStep, 'node check.mjs');
  // The same head is not checked twice.
  assert.equal(check().length, 1);
  // Commit the fix while the working tree holds a broken edit: the commit still passes.
  git('add', 'check.mjs');
  git('commit', '-m', 'fix the check', '--no-verify');
  writeFileSync(join(dir, 'check.mjs'), 'process.exit(1);\n');
  results = check();
  assert.equal(results.length, 2);
  assert.equal(results[1].outcome, 'passed');
  assert.equal(results[1].base, git('rev-parse', 'HEAD^'));
  assert.equal(
    existsSync(join(root, 'logs', 'main-check-worktrees', `${results[1].sha.slice(0, 12)}-0`)),
    false,
  );
  assert.equal(git('worktree', 'list').split('\n').length, 1);
});

test('post-commit does nothing off main', () => {
  const { dir, git } = repo();
  const root = mkdtempSync(join(tmpdir(), 'factory-root-'));
  writeFileSync(join(dir, 'a'), 'a');
  git('add', '.');
  git('commit', '-m', 'a', '--no-verify');
  git('switch', '-c', 'agent/task');
  const result = spawnSync(process.execPath, [join(scripts, 'run-post-commit.mjs')], {
    cwd: dir,
    env: { ...cleanEnv, FACTORY_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(existsSync(join(root, 'logs', 'main-checks.jsonl')), false);
});

test('setup sets core.hooksPath and a second run is safe', () => {
  const { dir, git } = repo();
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'bin'));
  copyFileSync(join(scripts, 'setup.mjs'), join(dir, 'scripts', 'setup.mjs'));
  cpSync(join(scripts, 'git-hooks'), join(dir, 'scripts', 'git-hooks'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'factory'), '#!/bin/sh\n');
  const env = { ...cleanEnv, FACTORY_BIN_DIR: join(mkdtempSync(join(tmpdir(), 'factory-bin-')), 'bin') };
  const setup = () =>
    spawnSync(process.execPath, [join(dir, 'scripts', 'setup.mjs'), '--no-install', '--no-doctor'], {
      cwd: dir,
      env,
      encoding: 'utf8',
    });
  const first = setup();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(git('config', '--get', 'core.hooksPath'), 'scripts/git-hooks');
  const second = setup();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(git('config', '--get', 'core.hooksPath'), 'scripts/git-hooks');
});
