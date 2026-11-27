#!/usr/bin/env node
// Git post-commit runner (called by scripts/git-hooks/post-commit). Advisory, branch `main` only.
// Detaches, then checks the newest main commit in a disposable detached worktree (so unstaged edits
// of other agents never leak into the result) and appends one line to $FACTORY_ROOT/logs/main-checks.jsonl.
// Env: FACTORY_ROOT (data root), FACTORY_MAIN_CHECK_COMMAND (replace ci-run, for tests),
// FACTORY_MAIN_CHECK_NO_INSTALL=1 (skip the offline install, for tests).
// Usage: node scripts/run-post-commit.mjs [--foreground]
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STALE_MS = 3 * 60 * 60 * 1000;
const env = { ...process.env };
// Inside a hook these point at the committing repo and break `git worktree add` (Little Buddy lesson).
for (const name of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX']) delete env[name];

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...args) => {
  try {
    return git(cwd, ...args);
  } catch {
    return undefined;
  }
};

const root = process.env.FACTORY_ROOT ?? join(homedir(), '.local', 'share', 'factory');
const logs = join(root, 'logs');
const resultsFile = join(logs, 'main-checks.jsonl');
const lockDir = join(logs, 'main-checks.lock');

function readResults() {
  try {
    return readFileSync(resultsFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquire() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'pid'), String(process.pid));
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(tryRead(join(lockDir, 'pid')));
      const age = Date.now() - statSync(lockDir).mtimeMs;
      if ((pid && alive(pid)) || (!pid && age < 10_000)) return false;
      rmSync(lockDir, { recursive: true, force: true });
    }
  }
  return false;
}
const tryRead = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

/** The base to compare with: the newest passed ancestor, else the first parent, else `--all`. */
function baseFor(top, sha, results) {
  const parents = git(top, 'rev-list', '--parents', '-n', '1', sha).split(' ').slice(1);
  if (parents.length === 0) return '--all';
  for (const entry of results.slice(-50).reverse()) {
    if (
      entry.outcome === 'passed' &&
      tryGit(top, 'merge-base', '--is-ancestor', entry.sha, sha) !== undefined
    )
      return entry.sha;
  }
  return parents[0];
}

function sweep(top, dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (Date.now() - statSync(path).mtimeMs < STALE_MS) continue;
    tryGit(top, 'worktree', 'remove', '--force', path);
    rmSync(path, { recursive: true, force: true });
  }
  tryGit(top, 'worktree', 'prune');
}

function checkCommit(top, sha, results) {
  const started = Date.now();
  const base = baseFor(top, sha, results);
  const short = sha.slice(0, 12);
  const worktrees = join(logs, 'main-check-worktrees');
  const dir = join(worktrees, `${short}-${process.pid}`);
  const logFile = join(logs, `main-check-${short}.log`);
  const entry = { sha, branch: 'main', base, outcome: 'error', startedAt: new Date(started).toISOString() };
  const custom = process.env.FACTORY_MAIN_CHECK_COMMAND;
  const out = openSync(logFile, 'w');
  try {
    sweep(top, worktrees);
    mkdirSync(worktrees, { recursive: true });
    git(top, 'worktree', 'add', '--detach', dir, sha);
    const stdio = ['ignore', out, out];
    const childEnv = { ...env, MAIN_CHECK_SHA: sha, MAIN_CHECK_BASE: base };
    let status = 0;
    if (process.env.FACTORY_MAIN_CHECK_NO_INSTALL !== '1') {
      const install = spawnSync('pnpm', ['install', '--frozen-lockfile', '--offline'], {
        cwd: dir,
        env: childEnv,
        stdio,
      });
      if (install.status !== 0) {
        entry.outcome = 'failed';
        entry.failedStep = 'pnpm install --frozen-lockfile --offline';
        status = -1;
      }
    }
    if (status === 0) {
      const run = custom
        ? spawnSync('sh', ['-c', custom], { cwd: dir, env: childEnv, stdio })
        : spawnSync(process.execPath, ['scripts/ci-run.mjs', base, sha], { cwd: dir, env: childEnv, stdio });
      if (run.error) throw run.error;
      entry.outcome = run.status === 0 ? 'passed' : 'failed';
      if (run.status !== 0) {
        const steps = tryRead(logFile)
          .split('\n')
          .filter((line) => line.startsWith('==> '));
        entry.failedStep = custom ?? steps.at(-1)?.slice(4) ?? 'ci-run';
      }
    }
  } catch (error) {
    entry.error = String(error.message ?? error).slice(0, 500);
  } finally {
    closeSync(out);
    tryGit(top, 'worktree', 'remove', '--force', dir);
    rmSync(dir, { recursive: true, force: true });
    tryGit(top, 'worktree', 'prune');
  }
  entry.finishedAt = new Date().toISOString();
  entry.durationMs = Date.now() - started;
  entry.log = logFile;
  return entry;
}

function foreground() {
  const top = git(process.cwd(), 'rev-parse', '--show-toplevel');
  mkdirSync(logs, { recursive: true });
  for (let round = 0; round < 5; round++) {
    if (!acquire()) return; // the running check re-reads main's head when it ends
    try {
      for (;;) {
        const sha = tryGit(top, 'rev-parse', 'refs/heads/main');
        const results = readResults();
        if (!sha || results.at(-1)?.sha === sha) break;
        appendFileSync(resultsFile, `${JSON.stringify(checkCommit(top, sha, results))}\n`);
      }
    } finally {
      rmSync(lockDir, { recursive: true, force: true });
    }
    const sha = tryGit(top, 'rev-parse', 'refs/heads/main');
    if (!sha || readResults().at(-1)?.sha === sha) return;
  }
}

if (process.argv.includes('--foreground')) foreground();
else {
  const top = tryGit(process.cwd(), 'rev-parse', '--show-toplevel');
  const branch = tryGit(process.cwd(), 'symbolic-ref', '--short', '-q', 'HEAD');
  if (top && branch === 'main')
    spawn(process.execPath, [fileURLToPath(import.meta.url), '--foreground'], {
      cwd: top,
      env,
      detached: true,
      stdio: 'ignore',
    }).unref();
}
