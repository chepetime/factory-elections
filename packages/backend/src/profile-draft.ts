// Drafts a repository profile from repository evidence. The draft is unapproved until a human sets approved_at.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, parseDocument, stringify } from 'yaml';
import { describeIssues, RepoProfile } from '@factory/core';
import { run } from '@factory/adapters-process';
import { profilePath, readProfile, writeProfileDraft } from '@factory/adapters-fs';

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

/** What a person checks before approving: the values a run depends on. */
export interface ProfileSummary {
  base_branch: string;
  setup?: string;
  test: string;
  full_check: string;
  forbidden_paths: string[];
}

export type ProfileStatus =
  | { state: 'missing'; path: string }
  | { state: 'draft'; path: string; summary: ProfileSummary }
  | { state: 'approved'; path: string; approved_at: string }
  | { state: 'invalid'; path: string; error: string };

function summarize(profile: RepoProfile): ProfileSummary {
  return {
    base_branch: profile.repo.base_branch.value,
    ...(profile.commands.setup ? { setup: profile.commands.setup } : {}),
    test: profile.commands.test,
    full_check: profile.commands.full_check,
    forbidden_paths: profile.confirmed.forbidden_paths,
  };
}

/** Checks everything except approved_at, so a draft is either ready to approve or reports what is wrong. */
function checkDraft(
  value: unknown,
  project: string,
): { ok: true; profile: RepoProfile } | { ok: false; error: string } {
  const parsed = RepoProfile.safeParse({ ...(value as object), approved_at: 'pending' });
  if (!parsed.success) return { ok: false, error: `invalid profile: ${describeIssues(parsed.error)}` };
  if (parsed.data.project !== project)
    return { ok: false, error: `profile project "${parsed.data.project}" does not match "${project}"` };
  return { ok: true, profile: parsed.data };
}

const unset = (approved: unknown) =>
  approved === undefined || approved === null || String(approved).trim() === '';

/** Whether the project's profile is missing, an unapproved draft, approved, or broken. */
export async function profileStatus(root: string, project: string): Promise<ProfileStatus> {
  const path = profilePath(root, project);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing', path };
    throw error;
  }
  try {
    const profile = await readProfile(root, project);
    return { state: 'approved', path, approved_at: String(profile.approved_at) };
  } catch (error) {
    let value: unknown;
    try {
      value = parse(text);
    } catch {
      return { state: 'invalid', path, error: error instanceof Error ? error.message : String(error) };
    }
    if (!unset((value as { approved_at?: unknown } | null)?.approved_at))
      return { state: 'invalid', path, error: error instanceof Error ? error.message : String(error) };
    const draft = checkDraft(value, project);
    return draft.ok
      ? { state: 'draft', path, summary: summarize(draft.profile) }
      : { state: 'invalid', path, error: draft.error };
  }
}

/**
 * Sets approved_at on a valid draft and keeps the file's comments. `today` is the local date,
 * YYYY-MM-DD. Throws with the reason when there is no draft or the draft is invalid.
 */
export async function approveProfile(root: string, project: string, today: string): Promise<ProfileStatus> {
  const status = await profileStatus(root, project);
  if (status.state === 'approved') return status;
  if (status.state === 'missing') throw new Error('There is no profile to approve. Draft one first.');
  if (status.state === 'invalid') throw new Error(`Fix the profile first: ${status.error}`);
  const doc = parseDocument(await readFile(status.path, 'utf8'));
  doc.set('approved_at', today);
  const temp = `${status.path}.approving`;
  await writeFile(temp, doc.toString());
  await rename(temp, status.path);
  return profileStatus(root, project);
}
