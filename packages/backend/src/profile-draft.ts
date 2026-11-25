// Drafts a repository profile from repository evidence. The draft is unapproved until a human sets approved_at.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { run } from '@factory/adapters-process';
import { writeProfileDraft } from '@factory/adapters-fs';

async function baseBranch(repo: string): Promise<{ value: string; source: string }> {
  const remoteHead = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: repo });
  if (remoteHead.code === 0)
    return { value: remoteHead.stdout.trim().replace(/^origin\//, ''), source: 'origin/HEAD' };
  const current = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo });
  return {
    value: current.code === 0 ? current.stdout.trim() : 'main',
    source: 'current branch at draft time',
  };
}

async function packageScripts(
  repo: string,
): Promise<{ manager: string; scripts: Record<string, string> } | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
      packageManager?: string;
    };
    const exists = async (f: string) =>
      readFile(join(repo, f)).then(
        () => true,
        () => false,
      );
    const manager =
      pkg.packageManager?.split('@')[0] ??
      ((await exists('pnpm-lock.yaml')) ? 'pnpm' : (await exists('yarn.lock')) ? 'yarn' : 'npm');
    return { manager, scripts: pkg.scripts ?? {} };
  } catch {
    return undefined;
  }
}

/** An install that never rewrites the lockfile, so verification leaves the worktree unchanged. */
async function installCommand(repo: string, manager: string): Promise<string> {
  const exists = async (f: string) =>
    readFile(join(repo, f)).then(
      () => true,
      () => false,
    );
  if (manager === 'pnpm') return 'pnpm install --frozen-lockfile';
  if (manager === 'yarn') return 'yarn install --immutable';
  if (manager === 'bun') return 'bun install --frozen-lockfile';
  return (await exists('package-lock.json')) ? 'npm ci' : 'npm install --no-package-lock';
}

export async function draftProfile(project: string, repo: string): Promise<string> {
  const pkg = await packageScripts(repo);
  const runScript = (name: string) => (pkg ? `${pkg.manager} run ${name}` : undefined);
  const test = pkg?.scripts.test ? runScript('test') : 'echo "set commands.test" && exit 1';
  const full = pkg
    ? (['check', 'ci', 'verify', 'lint']
        .map((s) => (pkg.scripts[s] ? runScript(s) : undefined))
        .find(Boolean) ?? test)
    : test;
  const install = pkg ? await installCommand(repo, pkg.manager) : undefined;
  const profile = {
    project,
    approved_at: '',
    repo: { base_branch: await baseBranch(repo) },
    commands: {
      test: install ? `${install} && ${test}` : test,
      full_check: full,
    },
    confirmed: { forbidden_paths: ['.env', '.github/workflows/'], forbidden_commands: [] as string[] },
    design_sources: [] as string[],
    qa_targets: [] as string[],
  };
  return [
    `# Repository profile for ${project} (${repo}).`,
    "# Drafted from repository evidence. Review every value, then set approved_at to today's date",
    '# (for example 2026-11-13). The factory refuses to work on the project until approved_at is set.',
    '#',
    '# commands.test and commands.full_check run with /bin/sh -c inside each task worktree.',
    '# confirmed.forbidden_paths: files the coder may not change (exact path, "dir/" prefix, or * glob).',
    '# confirmed.forbidden_commands: command substrings the coder may not run, in addition to git push/gh.',
    stringify(profile),
  ].join('\n');
}

export type ProfileDraft =
  { status: 'drafted' | 'exists'; path: string } | { status: 'failed'; error: string };

/**
 * Drafts <root>/<project>/profile.yaml from the repository when there is none. It never replaces an
 * existing profile, and a failure never blocks the caller (adding a project still succeeds).
 */
export async function ensureProfileDraft(root: string, project: string, repo: string): Promise<ProfileDraft> {
  try {
    return {
      status: 'drafted',
      path: await writeProfileDraft(root, project, await draftProfile(project, repo)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exists = /^profile already exists: (.+)$/.exec(message);
    return exists ? { status: 'exists', path: exists[1]! } : { status: 'failed', error: message };
  }
}
