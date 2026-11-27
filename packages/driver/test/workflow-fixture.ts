// Shared setup for the workflow tests: a scripted model, a real temporary git repository and a fake GitHub.
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ModelRun, ModelResult, ModelRunner, RepoProfile } from '@factory/core';
import * as fsAdapter from '@factory/adapters-fs';
import * as git from '@factory/adapters-git';
import { runShell } from '@factory/adapters-process';
import { Driver, type DriverDeps } from '../src/index.ts';

const DEFS = resolve(import.meta.dirname, '..', '..', '..', 'definitions');
const paths = (n: string) => ({
  step: join(DEFS, 'steps', `${n}.yaml`),
  ladder: join(DEFS, 'ladders', `${n}.yaml`),
});

export type Script = (run: ModelRun) => Promise<ModelResult> | ModelResult;

class ScriptedRunner implements ModelRunner {
  calls: ModelRun[] = [];
  readonly scripts: Record<string, Script[]>;
  constructor(scripts: Record<string, Script[]>) {
    this.scripts = scripts;
  }
  async run(request: ModelRun): Promise<ModelResult> {
    this.calls.push(request);
    const key =
      request.step === 'pr-writer'
        ? 'prWriter'
        : request.tools === 'none'
          ? 'classifier'
          : request.tools === 'edit'
            ? 'coder'
            : 'reviewer';
    const next = this.scripts[key]?.shift() ?? (key === 'prWriter' ? defaultDraft : undefined);
    if (!next) throw new Error(`no scripted response for ${key}`);
    return next(request);
  }
}

export function sh(cwd: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  });
}

export async function setup(
  scripts: Record<string, Script[]>,
  testCommand = 'test -f feature.txt',
  generatedPaths = '[]',
) {
  const base = await mkdtemp(join(tmpdir(), 'factory-wf-'));
  const root = join(base, 'data');
  const repo = join(base, 'repo');
  const remote = join(base, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  for (const [k, val] of [
    ['user.name', 't'],
    ['user.email', 't@example.com'],
  ])
    sh(repo, 'config', k!, val!);
  await writeFile(join(repo, 'README.md'), '# demo\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'init');
  sh(repo, 'remote', 'add', 'origin', remote);
  const projects = new fsAdapter.ProjectStore(root);
  await projects.add('demo', repo);
  await writeFile(
    join(root, 'demo', 'profile.yaml'),
    [
      'project: demo',
      'approved_at: "2026-11-13"',
      'repo: { base_branch: { value: main, source: test } }',
      `commands: { test: "${testCommand}", full_check: "true" }`,
      'confirmed: { forbidden_paths: [secrets/], forbidden_commands: [] }',
      `generated_paths: ${generatedPaths}`,
      'design_sources: []',
      'qa_targets: []',
    ].join('\n'),
  );
  const store = new fsAdapter.TaskStore(root);
  const task = await store.create('demo', repo, 'Add feature.txt', new Date().toISOString());
  const runner = new ScriptedRunner(scripts);
  const prs: { base: string; head: string; title: string; body: string }[] = [];
  let tick = 0;
  const deps: DriverDeps = {
    tasks: store,
    readProfile: (p) => fsAdapter.readProfile(root, p),
    git,
    // These tests run real commands; the sandbox itself is covered in adapters-process.
    shell: { runShell: (command, options) => runShell(command, { ...options, sandbox: undefined }) },
    github: {
      createPullRequest: async (o) => (prs.push(o), 'https://github.com/example/demo/pull/1'),
      pullRequestsFrom: async () => [],
    },
    runner,
    definitions: {
      readStep: fsAdapter.readStepDefinition,
      readLadder: fsAdapter.readLadder,
      exists: (p) =>
        access(p).then(
          () => true,
          () => false,
        ),
    },
    steps: {
      classifier: paths('classifier'),
      coder: paths('coder'),
      reviewer: paths('reviewer'),
      prWriter: paths('pr-writer'),
    },
    now: () => new Date(Date.UTC(2026, 10, 13, 0, 0, tick++)).toISOString(),
    log: () => {},
  };
  return { driver: new Driver(deps), store, task, repo, remote, runner, prs };
}

export const ready: Script = (r) => {
  const id = /"id": "([^"]+)"/.exec(r.prompt)![1];
  return {
    text: '',
    structured: {
      intake_id: id,
      name: 'Add the feature',
      kind: 'code',
      loe: 'S',
      readiness: 'ready',
      blockers: [],
    },
    costUsd: 0.001,
  };
};
export const writeFeature: Script = async (r) => (
  await writeFile(join(r.cwd!, 'feature.txt'), 'done\n'),
  { text: 'ok', costUsd: 0.1 }
);
export const writeOther: Script = async (r) => (
  await writeFile(join(r.cwd!, 'other.txt'), 'more\n'),
  { text: 'ok', costUsd: 0.1 }
);
export const defaultDraft: Script = () => ({
  text: '',
  structured: {
    title: 'Add the feature file',
    body: '## Summary\n\nAdds `feature.txt`.\n\n## Evidence\n\n- **Before:** none\n  **After:** test passes\n\n## Merge Danger\n\n**Door:** two-way',
  },
  costUsd: 0.02,
});
export const approveReview: Script = () => ({
  text: '',
  structured: { verdict: 'approve', summary: 'Looks right.', findings: [] },
  costUsd: 0.05,
});

/** A task whose worktree exists, with `files` already on main (the profile protects only secrets/). */
export async function withWorktree(files: Record<string, string> = {}) {
  const ctx = await setup({ classifier: [ready], coder: [writeFeature], reviewer: [approveReview] });
  for (const [file, text] of Object.entries(files)) {
    execFileSync('mkdir', ['-p', join(ctx.repo, file, '..')]);
    await writeFile(join(ctx.repo, file), text);
  }
  if (Object.keys(files).length) {
    sh(ctx.repo, 'add', '.');
    sh(ctx.repo, 'commit', '-qm', 'protected files');
  }
  await ctx.driver.classify('demo', ctx.task.id);
  await ctx.driver.prepareWorktree('demo', ctx.task.id);
  const path = (await ctx.store.read('demo', ctx.task.id)).worktree!.path;
  // What an agent does with Bash or a commit of its own: the change lands without being staged.
  const commit = (message: string) => {
    sh(path, 'add', '-A');
    sh(path, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', message);
  };
  return { ...ctx, path, commit };
}

/** Gives the profile spending and time limits, as a repository owner would in profile.yaml. */
export function withLimits(driver: Driver, limits: Record<string, number>) {
  const read = driver.deps.readProfile;
  driver.deps.readProfile = async (p) => ({ ...(await read(p)), limits });
}

/** Overrides profile fields for one test driver. */
export function withProfile(driver: Driver, change: (profile: RepoProfile) => RepoProfile) {
  const read = driver.deps.readProfile;
  driver.deps.readProfile = async (p) => change(await read(p));
}
