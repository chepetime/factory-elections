// Merging the base into a task branch. A tool resolves some conflicts better than an agent: a
// lockfile is regenerated from the merged package files, and a file the repository generates (its
// profile's `regenerate` rules) is rebuilt by its command, outside the sandbox, so the agent gets only
// the conflicts that need judgment.
import { dirname, join, matchesGlob } from 'node:path';
import type { RepoProfile } from '@factory/core';
import type { DriverDeps } from './ports.ts';

/** Lockfiles by file name, with the command that rewrites one from its package files. */
const LOCKFILES: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm install --lockfile-only --ignore-scripts',
  'package-lock.json': 'npm install --package-lock-only --ignore-scripts',
};

/** A profile rule: conflicted files matching `paths` are rebuilt by running `command` at the root. */
export type RegenerateRule = NonNullable<RepoProfile['regenerate']>[number];

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const NO_HOOKS = 'git -c core.hooksPath=/dev/null -c user.useConfigOnly=false';
const files = (list: string[]) => list.map(quote).join(' ');

/**
 * Merges `ref` into the branch in `dir`. Conflicted lockfiles and files matching a `rules` glob are
 * taken from `ref` and regenerated; when they were the only conflicts, the merge is committed.
 * `regenerated` names the files the factory rewrote; a file whose command failed stays in
 * `conflicted` for the agent, with its conflict markers back.
 */
export async function mergeBase(
  deps: Pick<DriverDeps, 'git' | 'shell' | 'log'>,
  dir: string,
  ref: string,
  rules: readonly RegenerateRule[] = [],
): Promise<{ clean: boolean; conflicted: string[]; regenerated: string[] }> {
  const merge = await deps.git.mergeRef!(dir, ref);
  if (merge.clean) return { ...merge, regenerated: [] };
  const regenerated: string[] = [];
  const left: string[] = [];
  const byRule = new Map<RegenerateRule, string[]>();
  for (const file of merge.conflicted) {
    const rule = rules.find((r) => r.paths.some((glob) => matchesGlob(file, glob)));
    if (rule) {
      byRule.set(rule, [...(byRule.get(rule) ?? []), file]);
      continue;
    }
    const command = LOCKFILES[file.split('/').at(-1)!];
    if (!command) {
      left.push(file);
      continue;
    }
    // In a merge, "theirs" is `ref`: start from the base's lockfile, then add the branch's changes.
    const result = await deps.shell.runShell(
      `git checkout --theirs -- ${quote(file)} && (cd ${quote(dirname(join(dir, file)))} && ${command}) && git add -- ${quote(file)}`,
      { cwd: dir, captureLimit: 4000, timeoutMs: 10 * 60_000 },
    );
    if (result.code === 0) regenerated.push(file);
    else {
      deps.log(`Could not regenerate ${file}; it goes to the agent: ${result.stderr.trim().slice(-500)}`);
      left.push(file);
    }
  }
  // Once per rule, after all its files hold the base's copy: the command sees the merged sources.
  for (const [rule, matched] of byRule) {
    const result = await deps.shell.runShell(
      `git checkout --theirs -- ${files(matched)} && (${rule.command}) && git add -- ${files(matched)}`,
      { cwd: dir, captureLimit: 4000, timeoutMs: 10 * 60_000 },
    );
    if (result.code === 0) regenerated.push(...matched);
    else {
      const why = (result.stderr.trim() || result.stdout.trim()).slice(-500);
      deps.log(
        `Could not regenerate ${matched.join(', ')} with \`${rule.command}\`; they go to the agent: ${why}`,
      );
      // Put the conflict markers back so the agent sees both sides, not the base's copy.
      await deps.shell.runShell(`git checkout -m -- ${files(matched)}`, { cwd: dir, captureLimit: 4000 });
      left.push(...matched);
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
