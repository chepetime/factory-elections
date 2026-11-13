// Bounded git operations used by the driver. Every call names its repository or worktree explicitly.
import { realpath } from 'node:fs/promises';
import { run } from '@factory/adapters-process';

export class GitError extends Error {}

async function git(cwd: string, args: string[], input?: string): Promise<string> {
  const result = await run('git', args, {
    cwd,
    input,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
  if (result.code !== 0)
    throw new GitError(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  return (await run('git', args, { cwd })).code === 0;
}

export async function topLevel(dir: string): Promise<string | undefined> {
  const result = await run('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
  return result.code === 0 ? realpath(result.stdout.trim()) : undefined;
}

/** The repository's main working tree, even when dir is a linked worktree. */
export async function commonRepo(dir: string): Promise<string | undefined> {
  const result = await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir });
  return result.code === 0 ? realpath(result.stdout.trim()) : undefined;
}

export async function isClean(dir: string): Promise<boolean> {
  return (await git(dir, ['status', '--porcelain'])).trim() === '';
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  return gitOk(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
}

export async function currentBranch(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

export async function headSha(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', 'HEAD'])).trim();
}

export async function addWorktree(repo: string, path: string, branch: string, base: string): Promise<void> {
  await git(repo, ['worktree', 'add', '-b', branch, path, base]);
}

export async function removeWorktree(repo: string, path: string, branch: string): Promise<void> {
  await run('git', ['worktree', 'remove', '--force', path], { cwd: repo });
  await run('git', ['branch', '-D', branch], { cwd: repo });
}

/** Stages everything in the worktree and returns the repository-relative paths that changed. */
export async function stageAll(dir: string): Promise<string[]> {
  await git(dir, ['add', '-A']);
  const out = await git(dir, ['diff', '--cached', '--name-only', '-z']);
  return out.split('\0').filter(Boolean);
}

export async function unstageAll(dir: string): Promise<void> {
  await git(dir, ['reset', '-q']);
}

export async function commit(dir: string, message: string): Promise<string> {
  await git(dir, ['-c', 'user.useConfigOnly=false', 'commit', '-q', '--no-verify', '-F', '-'], message);
  return headSha(dir);
}

export async function changedFilesSince(dir: string, base: string): Promise<string[]> {
  return (await git(dir, ['diff', '--name-only', '-z', `${base}...HEAD`])).split('\0').filter(Boolean);
}

export async function diffSince(dir: string, base: string, stat = false): Promise<string> {
  return git(dir, ['diff', ...(stat ? ['--stat'] : []), `${base}...HEAD`]);
}

export async function commitCountSince(dir: string, base: string): Promise<number> {
  return Number((await git(dir, ['rev-list', '--count', `${base}..HEAD`])).trim());
}

export async function remoteUrl(dir: string, remote = 'origin'): Promise<string | undefined> {
  const result = await run('git', ['remote', 'get-url', remote], { cwd: dir });
  return result.code === 0 ? result.stdout.trim() : undefined;
}

export async function push(dir: string, branch: string, remote = 'origin'): Promise<void> {
  await git(dir, ['push', '--set-upstream', remote, `${branch}:${branch}`]);
}
