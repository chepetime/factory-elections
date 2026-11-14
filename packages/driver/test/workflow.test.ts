// End-to-end workflow with a scripted model, a real temporary git repository and a fake GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ModelRun, ModelResult, ModelRunner } from '@factory/core';
import * as fsAdapter from '@factory/adapters-fs';
import * as git from '@factory/adapters-git';
import { runShell } from '@factory/adapters-process';
import { Driver, type DriverDeps } from '../src/index.ts';

const DEFS = resolve(import.meta.dirname, '..', '..', '..', 'definitions');
const paths = (n: string) => ({
  step: join(DEFS, 'steps', `${n}.yaml`),
  ladder: join(DEFS, 'ladders', `${n}.yaml`),
});

type Script = (run: ModelRun) => Promise<ModelResult> | ModelResult;

class ScriptedRunner implements ModelRunner {
  calls: ModelRun[] = [];
  readonly scripts: Record<string, Script[]>;
  constructor(scripts: Record<string, Script[]>) {
    this.scripts = scripts;
  }
  async run(request: ModelRun): Promise<ModelResult> {
    this.calls.push(request);
    const key = request.tools === 'none' ? 'classifier' : request.tools === 'edit' ? 'coder' : 'reviewer';
    const next = this.scripts[key]?.shift();
    if (!next) throw new Error(`no scripted response for ${key}`);
    return next(request);
  }
}

function sh(cwd: string, ...args: string[]) {
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

async function setup(scripts: Record<string, Script[]>, testCommand = 'test -f feature.txt') {
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
    shell: { runShell },
    github: { createPullRequest: async (o) => (prs.push(o), 'https://github.com/example/demo/pull/1') },
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
    steps: { classifier: paths('classifier'), coder: paths('coder'), reviewer: paths('reviewer') },
    now: () => new Date(Date.UTC(2026, 10, 13, 0, 0, tick++)).toISOString(),
    log: () => {},
  };
  return { driver: new Driver(deps), store, task, repo, remote, runner, prs };
}

const ready: Script = (r) => {
  const id = /"id": "([^"]+)"/.exec(r.prompt)![1];
  return {
    text: '',
    structured: { intake_id: id, kind: 'code', loe: 'S', readiness: 'ready', blockers: [] },
    costUsd: 0.001,
  };
};
const writeFeature: Script = async (r) => (
  await writeFile(join(r.cwd!, 'feature.txt'), 'done\n'),
  { text: 'ok', costUsd: 0.1 }
);
const approveReview: Script = () => ({
  text: '',
  structured: { verdict: 'approve', summary: 'Looks right.', findings: [] },
  costUsd: 0.05,
});

test('task goes from intake to an opened pull request only after approval', async () => {
  const { driver, store, task, remote, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  const reviewed = await driver.run('demo', task.id, { maxAttempts: 2 });
  assert.equal(reviewed.stage, 'awaiting-approval');
  assert.equal(reviewed.verification?.passed, true);
  await assert.rejects(driver.openPr('demo', task.id), /not approved|has not approved/);
  assert.equal(prs.length, 0);

  const gate = await driver.gate('demo', task.id);
  assert.deepEqual(gate.blockers, []);
  await assert.rejects(driver.approve('demo', task.id, { head: '0000000' }), /--head/);
  await driver.approve('demo', task.id, { head: gate.headSha.slice(0, 10), note: 'ship it' });
  const opened = await driver.openPr('demo', task.id);
  assert.equal(opened.stage, 'pr-opened');
  assert.equal(prs[0]?.head, `factory/${task.id}`);
  assert.equal(prs[0]?.base, 'main');
  assert.match(prs[0]!.body, /ship it/);
  assert.equal(
    execFileSync('git', ['rev-parse', `refs/heads/factory/${task.id}`], {
      cwd: remote,
      encoding: 'utf8',
    }).trim(),
    gate.headSha,
  );
  const stored = await store.read('demo', task.id);
  assert.deepEqual(
    stored.attempts?.map((a) => a.step),
    ['classifier', 'coder', 'reviewer'],
  );
  await assert.rejects(driver.openPr('demo', task.id), /already open/);
});

test('verification failure climbs the ladder with the failure output', async () => {
  const noop: Script = async (r) => (
    await writeFile(join(r.cwd!, 'other.txt'), 'x\n'),
    { text: 'ok', costUsd: null }
  );
  const { driver, task, runner } = await setup({
    classifier: [ready],
    coder: [noop, writeFeature],
    reviewer: [approveReview],
  });
  const reviewed = await driver.run('demo', task.id, { maxAttempts: 3 });
  assert.equal(reviewed.stage, 'awaiting-approval');
  const coderCalls = runner.calls.filter((c) => c.tools === 'edit');
  assert.equal(coderCalls[0]?.model, 'claude-sonnet-5-5');
  assert.equal(coderCalls[1]?.effort, 'high');
  assert.match(coderCalls[1]!.prompt, /failed verification/);
});

test('unclear tasks stop before any code', async () => {
  const unclear: Script = (r) => {
    const id = /"id": "([^"]+)"/.exec(r.prompt)![1];
    return {
      text: '',
      structured: {
        intake_id: id,
        kind: 'code',
        loe: 'unknown',
        readiness: 'needs-clarification',
        blockers: [{ kind: 'clarification', question: 'Which file?' }],
      },
      costUsd: 0,
    };
  };
  const { driver, task, runner } = await setup({ classifier: [unclear] });
  const result = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(result.stage, 'blocked');
  assert.equal(result.worktree, undefined);
  assert.equal(runner.calls.length, 1);
});

test('coder changes to forbidden paths fail and are not committed', async () => {
  const bad: Script = async (r) => {
    execFileSync('mkdir', ['-p', join(r.cwd!, 'secrets')]);
    await writeFile(join(r.cwd!, 'secrets', 'k'), 'x');
    return { text: 'ok', costUsd: 0 };
  };
  const { driver, task, store } = await setup({ classifier: [ready], coder: [bad] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /forbidden paths/);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'failed');
  assert.equal(await git.commitCountSince(stored.worktree!.path, 'main'), 0);
});

test('the coder guard denies pushes and paths outside the worktree', async () => {
  let denials: (string | undefined)[] = [];
  const probe: Script = async (r) => {
    denials = [
      r.guard!.check('Bash', { command: 'git push origin HEAD' }),
      r.guard!.check('Read', { file_path: '/etc/passwd' }),
      r.guard!.check('Write', { file_path: join(r.cwd!, 'secrets/x') }),
      r.guard!.check('Write', { file_path: join(r.cwd!, 'feature.txt') }),
    ];
    return writeFeature(r);
  };
  const { driver, task } = await setup({ classifier: [ready], coder: [probe], reviewer: [approveReview] });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.ok(denials[0] && denials[1] && denials[2]);
  assert.equal(denials[3], undefined);
});

test('revision reruns the coder with the human note and requires a new approval', async () => {
  const revise: Script = async (r) => {
    assert.match(r.prompt, /make it louder/);
    await writeFile(join(r.cwd!, 'feature.txt'), 'DONE\n');
    return { text: 'ok', costUsd: 0 };
  };
  const { driver, task } = await setup({
    classifier: [ready],
    coder: [writeFeature, revise],
    reviewer: [approveReview, approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const first = await driver.gate('demo', task.id);
  const revised = await driver.revise('demo', task.id, 'make it louder', { maxAttempts: 1 });
  assert.equal(revised.stage, 'awaiting-approval');
  assert.equal(revised.approval, undefined);
  const second = await driver.gate('demo', task.id);
  assert.notEqual(first.headSha, second.headSha);
  await assert.rejects(driver.approve('demo', task.id, { head: first.headSha.slice(0, 10) }), /--head/);
  assert.equal(await readFile(join(revised.worktree!.path, 'feature.txt'), 'utf8'), 'DONE\n');
});

test('blocking review findings need explicit acceptance', async () => {
  const blocking: Script = () => ({
    text: '',
    structured: {
      verdict: 'request-changes',
      summary: 'Bug.',
      findings: [{ severity: 'blocking', message: 'wrong' }],
    },
    costUsd: 0,
  });
  const { driver, task } = await setup({ classifier: [ready], coder: [writeFeature], reviewer: [blocking] });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await assert.rejects(driver.approve('demo', task.id, { head: gate.headSha.slice(0, 10) }), /blocking/);
  const approved = await driver.approve('demo', task.id, {
    head: gate.headSha.slice(0, 10),
    acceptBlocking: true,
  });
  assert.equal(approved.stage, 'approved');
});

test('verification that leaves uncommitted files fails', async () => {
  const { driver, task, store } = await setup(
    { classifier: [ready], coder: [writeFeature] },
    'test -f feature.txt && touch artifact.out',
  );
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'verification-failed');
  assert.match(stored.verification!.output_tail, /artifact\.out/);
  assert.equal(stored.attempts?.[0]?.step, 'classifier');
});

test('verification fails when the change commits generated files', async () => {
  const writeWithCache: Script = async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
    await writeFile(join(r.cwd!, 'tsconfig.tsbuildinfo'), '{}\n');
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task, store } = await setup({ classifier: [ready], coder: [writeWithCache] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'verification-failed');
  assert.match(stored.verification!.output_tail, /generated files: tsconfig\.tsbuildinfo/);
});
