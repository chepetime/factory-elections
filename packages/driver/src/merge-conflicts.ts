// Merging the base into a task branch. A tool resolves some conflicts better than an agent: a
// lockfile is regenerated from the merged package files, so the agent gets only the conflicts that
// need judgment. Git runs outside the sandbox (it writes the main repository's .git); the lockfile
// tool reads the coder's package files and config, so it runs in the check sandbox.
import { dirname, join } from 'node:path';
import type { RepoProfile } from '@factory/core';
import type { DriverDeps } from './ports.ts';
import { checkOptions } from './verification.ts';

/** Lockfiles by file name, with the command that rewrites one from its package files. */
const LOCKFILES: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm install --lockfile-only --ignore-scripts --ignore-pnpmfile',
  'package-lock.json': 'npm install --package-lock-only --ignore-scripts',
};

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const NO_HOOKS = 'git -c core.hooksPath=/dev/null -c user.useConfigOnly=false';

/**
 * Merges `ref` into the branch in `dir`. Conflicted lockfiles are taken from `ref` and regenerated;
 * when they were the only conflicts, the merge is committed. `regenerated` names the lockfiles the
 * factory rewrote; a lockfile whose command failed stays in `conflicted` for the agent.
 */
export async function mergeBase(
  deps: Pick<DriverDeps, 'git' | 'shell' | 'log'>,
  dir: string,
  ref: string,
  profile: Pick<RepoProfile, 'sandbox'> = {},
): Promise<{ clean: boolean; conflicted: string[]; regenerated: string[] }> {
  const merge = await deps.git.mergeRef!(dir, ref);
  if (merge.clean) return { ...merge, regenerated: [] };
  const regenerated: string[] = [];
  const left: string[] = [];
  for (const file of merge.conflicted) {
    const command = LOCKFILES[file.split('/').at(-1)!];
    if (!command) {
      left.push(file);
      continue;
    }
    // In a merge, "theirs" is `ref`: start from the base's lockfile, then add the branch's changes.
    const git = (args: string) =>
      deps.shell.runShell(`${NO_HOOKS} ${args}`, { cwd: dir, captureLimit: 4000 });
    let result = await git(`checkout --theirs -- ${quote(file)}`);
    if (result.code === 0)
      result = await deps.shell.runShell(command, {
        ...checkOptions(profile, dir),
        cwd: dirname(join(dir, file)),
        captureLimit: 4000,
        timeoutMs: 10 * 60_000,
      });
    if (result.code === 0) result = await git(`add -- ${quote(file)}`);
    if (result.code === 0) regenerated.push(file);
    else {
      deps.log(`Could not regenerate ${file}; it goes to the agent: ${result.stderr.trim().slice(-500)}`);
      left.push(file);
    }
  }
  if (regenerated.length) deps.log(`Regenerated ${regenerated.join(', ')} after merging ${ref}.`);
  if (left.length) return { clean: false, conflicted: left, regenerated };
  const commit = await deps.shell.runShell(`${NO_HOOKS} commit --no-edit -q`, {
    cwd: dir,
    captureLimit: 4000,
  });
  if (commit.code !== 0) throw new Error(`could not commit the merge of ${ref}: ${commit.stderr.trim()}`);
  return { clean: true, conflicted: [], regenerated };
}
