// Bounded git operations used by the driver. Every call names its repository or worktree explicitly.
import { appendFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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

/** The tail of each repository's queue of administrative git commands, by common git directory. */
const repoQueues = new Map<string, Promise<unknown>>();

/**
 * Runs `action` alone among this process's administrative commands on the repository that `dir`
 * belongs to. Parallel tasks and reviews share one repository's refs and worktree list, and git
 * fails with "cannot lock ref" when two of these commands overlap.
 */
export async function exclusive<T>(dir: string, action: () => Promise<T>): Promise<T> {
  const key = (await commonRepo(dir)) ?? dir;
  const previous = repoQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  const tail = next.catch(() => undefined);
  repoQueues.set(key, tail);
  try {
    return await next;
  } finally {
    if (repoQueues.get(key) === tail) repoQueues.delete(key);
  }
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

/**
 * Ignores `pattern` in this repository only (`info/exclude`, never committed), e.g. a tool's local
 * session files. Shared by every worktree of the repository.
 */
export async function excludeLocally(dir: string, pattern: string): Promise<void> {
  const common = resolve(dir, (await git(dir, ['rev-parse', '--git-common-dir'])).trim());
  const file = join(common, 'info', 'exclude');
  const text = await readFile(file, 'utf8').catch(() => '');
  if (text.split('\n').some((line) => line.trim() === pattern)) return;
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${text && !text.endsWith('\n') ? '\n' : ''}${pattern}\n`);
}

export async function isClean(dir: string): Promise<boolean> {
  return (await git(dir, ['status', '--porcelain'])).trim() === '';
}

/** Tracked paths with uncommitted changes, staged or not. Untracked files are left out. */
export async function changedFiles(dir: string): Promise<string[]> {
  return (await git(dir, ['diff', '--name-only', 'HEAD'])).split('\n').filter(Boolean);
}

/** Paths with uncommitted or untracked (not ignored) changes. */
export async function dirtyFiles(dir: string): Promise<string[]> {
  return (await git(dir, ['status', '--porcelain', '-z', '--untracked-files=all']))
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3));
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

/** The commit a ref points at, or undefined when there is no ref or git cannot tell. */
export async function commitOf(repo: string, ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  return (
    (await git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => '')).trim() ||
    undefined
  );
}

export async function addWorktree(repo: string, path: string, branch: string, base: string): Promise<void> {
  await exclusive(repo, () => git(repo, ['worktree', 'add', '-b', branch, path, base]));
}

export async function removeWorktree(repo: string, path: string, branch: string): Promise<void> {
  await exclusive(repo, async () => {
    await run('git', ['worktree', 'remove', '--force', path], { cwd: repo });
    await run('git', ['branch', '-D', branch], { cwd: repo });
  });
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

/** Paths the branch adds or modifies since it left `base`; deletions are not listed. */
export async function addedOrModifiedSince(dir: string, base: string): Promise<string[]> {
  return (await git(dir, ['diff', '--name-only', '--diff-filter=d', '-z', `${base}...HEAD`]))
    .split('\0')
    .filter(Boolean);
}

/** Added and deleted lines per path, retaining rename destinations and binary markers. */
export async function diffLineCounts(
  dir: string,
  base: string,
): Promise<{ path: string; added: number | null; deleted: number | null }[]> {
  const fields = (await git(dir, ['diff', '--numstat', '-z', `${base}...HEAD`])).split('\0');
  const result: { path: string; added: number | null; deleted: number | null }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (!field) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(field);
    if (!match) throw new Error('Unexpected git numstat output');
    let path = match[3]!;
    if (!path) {
      i++;
      path = fields[++i] ?? '';
    }
    if (!path) throw new Error('Missing path in git numstat output');
    result.push({
      path,
      added: match[1] === '-' ? null : Number(match[1]),
      deleted: match[2] === '-' ? null : Number(match[2]),
    });
  }
  return result;
}

export async function diffSince(dir: string, base: string, stat = false): Promise<string> {
  return git(dir, ['diff', ...(stat ? ['--stat'] : []), `${base}...HEAD`]);
}

/**
 * The patch a commit adds to the merge base of that commit and `baseRef` (`origin/main`): what the
 * pull request changes at that head. Renames are shown as a delete and an add, so each path has its
 * own patch. Used to compare heads file by file (see core approval-carry.ts).
 */
export async function patchOf(dir: string, head: string, baseRef: string): Promise<string> {
  const mergeBase = (await git(dir, ['merge-base', head, baseRef])).trim();
  return git(dir, ['diff', '--no-color', '--no-ext-diff', '--no-renames', '-U3', mergeBase, head]);
}

export async function commitCountSince(dir: string, base: string): Promise<number> {
  return Number((await git(dir, ['rev-list', '--count', `${base}..HEAD`])).trim());
}

export async function remoteUrl(dir: string, remote = 'origin'): Promise<string | undefined> {
  const result = await run('git', ['remote', 'get-url', remote], { cwd: dir });
  return result.code === 0 ? result.stdout.trim() : undefined;
}

export async function push(dir: string, branch: string, remote = 'origin'): Promise<void> {
  await exclusive(dir, () => git(dir, ['push', '--set-upstream', remote, `${branch}:${branch}`]));
}

/** `git fetch --all --prune`, retrying once after packing refs when a stale ref lock blocks it. */
export async function fetchAllPrune(repo: string): Promise<void> {
  await exclusive(repo, () => fetchAllPruneNow(repo));
}

async function fetchAllPruneNow(repo: string): Promise<void> {
  const first = await run('git', ['fetch', '--all', '--prune'], { cwd: repo });
  if (first.code === 0) return;
  if (/cannot lock ref/.test(first.stderr)) {
    await run('git', ['pack-refs', '--all'], { cwd: repo });
    await git(repo, ['fetch', '--all', '--prune']);
    return;
  }
  throw new GitError(`git fetch --all --prune failed: ${(first.stderr || first.stdout).trim()}`);
}

export async function remoteBranchExists(repo: string, branch: string, remote = 'origin'): Promise<boolean> {
  return gitOk(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`]);
}

/** Registered worktree paths of the repository, as git reports them. */
export async function worktreePaths(repo: string): Promise<string[]> {
  return (await git(repo, ['worktree', 'list', '--porcelain']))
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

/** Creates or resets `branch` at `base` and checks it out in a new worktree at `path`. */
export async function addWorktreeAt(repo: string, path: string, branch: string, base: string): Promise<void> {
  await exclusive(repo, () => git(repo, ['worktree', 'add', '-B', branch, path, base]));
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

/** Aborts an in-progress merge, rebase or cherry-pick, then hard-resets the worktree to `ref`. */
export async function resetWorktreeHard(dir: string, ref: string): Promise<void> {
  const gitDir = (await git(dir, ['rev-parse', '--absolute-git-dir'])).trim();
  const has = async (name: string) => gitOk(dir, ['rev-parse', '--verify', '--quiet', name]);
  if (await has('MERGE_HEAD')) await git(dir, ['merge', '--abort']);
  else if ((await isDirectory(`${gitDir}/rebase-merge`)) || (await isDirectory(`${gitDir}/rebase-apply`)))
    await git(dir, ['rebase', '--abort']);
  else if (await has('CHERRY_PICK_HEAD')) await git(dir, ['cherry-pick', '--abort']);
  await git(dir, ['reset', '--hard', ref]);
}

/** Fetches these refs from origin. Administrative, so it runs alone on the repository. */
export async function fetchRefs(dir: string, refs: string[]): Promise<void> {
  await exclusive(dir, () => git(dir, ['fetch', '-q', 'origin', ...refs]));
}

/** Fast-forwards the current branch to `ref`. False when the branch has diverged from it. */
export async function fastForwardTo(dir: string, ref: string): Promise<boolean> {
  return gitOk(dir, ['merge', '-q', '--ff-only', ref]);
}

/**
 * Merges `ref` into the current branch. `clean`: the merge is committed. Otherwise the merge stops
 * on conflicts and stays in progress, with the conflicted paths listed. Any other failure throws.
 */
export async function mergeRef(dir: string, ref: string): Promise<{ clean: boolean; conflicted: string[] }> {
  const result = await run('git', ['-c', 'user.useConfigOnly=false', 'merge', '--no-edit', '-q', ref], {
    cwd: dir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
  if (result.code === 0) return { clean: true, conflicted: [] };
  const conflicted = (await git(dir, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
  if (!conflicted.length) {
    await gitOk(dir, ['merge', '--abort']);
    throw new GitError(`git merge ${ref} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return { clean: false, conflicted };
}

/** Whether a merge is in progress (MERGE_HEAD exists). */
export async function mergeInProgress(dir: string): Promise<boolean> {
  return gitOk(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
}

/** Stops a merge in progress and restores the branch head. */
export async function abortMerge(dir: string): Promise<void> {
  await gitOk(dir, ['merge', '--abort']);
}
