// Stale git lock files left by a process that died during a git command. Task worktrees share one
// repository with the person's own checkout, so only the locks that belong to the task are removed;
// every other lock is reported for a person to look at.
import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { run } from '@factory/adapters-process';

/** Whether a live `git` process runs with `worktree` (or a folder in it) as its working directory. */
export type LiveGitProbe = (worktree: string) => Promise<boolean>;

export interface StaleLockOptions {
  /** The task branch: its ref lock in the common git directory is the task's own. */
  branch: string;
  /** Only a lock last changed before this time (ms since the epoch) can be stale. */
  olderThan: number;
  /** Absent: `lsof`. When the probe throws, no lock is removed. */
  liveGit?: LiveGitProbe;
}

export interface StaleLockReport {
  /** Locks that were removed. */
  removed: string[];
  /** The task's own locks that were left alone, with the reason. */
  kept: { path: string; reason: 'newer than the backend start' | 'a git process is running' | string }[];
  /** Locks outside the task's own git files: never removed. */
  reported: string[];
}

/** `lsof -a -c git -d cwd`: does any git process work inside the worktree? Throws when lsof cannot say. */
export const lsofLiveGit: LiveGitProbe = async (worktree) => {
  const result = await run('lsof', ['-a', '-c', 'git', '-d', 'cwd', '-Fn']);
  // lsof exits 1 when nothing matches; any other failure means it could not look.
  if (result.code !== 0 && !(result.code === 1 && !result.stderr.trim()))
    throw new Error(`lsof failed: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`);
  const root = resolve(worktree);
  return result.stdout
    .split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => resolve(line.slice(1)))
    .some((cwd) => cwd === root || cwd.startsWith(root + sep));
};

async function gitPath(dir: string, flag: string): Promise<string> {
  const result = await run('git', ['rev-parse', '--path-format=absolute', flag], { cwd: dir });
  if (result.code !== 0) throw new Error(`git rev-parse ${flag} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function modifiedAt(path: string): Promise<number | undefined> {
  return (await stat(path).catch(() => undefined))?.mtimeMs;
}

async function locksIn(dir: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) found.push(...(await locksIn(path, true)));
    } else if (entry.name.endsWith('.lock')) found.push(path);
  }
  return found;
}

/**
 * Removes the stale locks of one task worktree: `index.lock`, `HEAD.lock` and `ORIG_HEAD.lock` in
 * its own git directory, and the lock of its branch ref in the common directory. A lock is removed
 * only when it is older than `olderThan` and no live git process works in the worktree. Every other
 * lock (`packed-refs.lock`, `config.lock`, other refs, the main worktree's index, other
 * worktrees') is only reported: the person's own git may hold it.
 */
export async function clearStaleGitLocks(
  worktree: string,
  options: StaleLockOptions,
): Promise<StaleLockReport> {
  const gitDir = await gitPath(worktree, '--absolute-git-dir');
  const common = await gitPath(worktree, '--git-common-dir');
  const own = new Set(['index.lock', 'HEAD.lock', 'ORIG_HEAD.lock'].map((name) => join(gitDir, name)));
  own.add(join(common, 'refs', 'heads', `${options.branch}.lock`));
  const report: StaleLockReport = { removed: [], kept: [], reported: [] };
  const live = options.liveGit ?? lsofLiveGit;
  let running: boolean | Error | undefined;
  for (const path of own) {
    const changed = await modifiedAt(path);
    if (changed === undefined) continue;
    if (changed >= options.olderThan) {
      report.kept.push({ path, reason: 'newer than the backend start' });
      continue;
    }
    running ??= await live(worktree).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    );
    if (running === true) report.kept.push({ path, reason: 'a git process is running' });
    else if (running instanceof Error)
      report.kept.push({ path, reason: `could not check for git: ${running.message}` });
    else {
      await rm(path, { force: true });
      report.removed.push(path);
    }
  }
  const others = [
    ...(await locksIn(common, false)),
    ...(await locksIn(join(common, 'refs'), true)),
    ...(gitDir === common ? [] : await locksIn(gitDir, false)),
  ];
  for (const name of await readdir(join(common, 'worktrees')).catch(() => [] as string[])) {
    const dir = join(common, 'worktrees', name);
    if (dir !== gitDir) others.push(...(await locksIn(dir, false)));
  }
  report.reported = [...new Set(others)].filter((path) => !own.has(path)).sort();
  return report;
}
