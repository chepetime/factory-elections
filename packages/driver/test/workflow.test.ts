// End-to-end workflow with a scripted model, a real temporary git repository and a fake GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

type Script = (run: ModelRun) => Promise<ModelResult> | ModelResult;

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

async function setup(
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
    shell: { runShell },
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

const ready: Script = (r) => {
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
const writeFeature: Script = async (r) => (
  await writeFile(join(r.cwd!, 'feature.txt'), 'done\n'),
  { text: 'ok', costUsd: 0.1 }
);
const writeOther: Script = async (r) => (
  await writeFile(join(r.cwd!, 'other.txt'), 'more\n'),
  { text: 'ok', costUsd: 0.1 }
);
const defaultDraft: Script = () => ({
  text: '',
  structured: {
    title: 'Add the feature file',
    body: '## Summary\n\nAdds `feature.txt`.\n\n## Evidence\n\n- **Before:** none\n  **After:** test passes\n\n## Merge Danger\n\n**Door:** two-way',
  },
  costUsd: 0.02,
});
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
  assert.equal(reviewed.name, 'Add the feature');
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
  assert.equal(prs[0]?.title, 'Add the feature file');
  assert.match(prs[0]!.body, /^## Summary\n\nAdds `feature.txt`\./);
  assert.match(prs[0]!.body, /<summary>Factory record<\/summary>/);
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
    ['classifier', 'coder', 'reviewer', 'pr-writer'],
  );
  await assert.rejects(driver.openPr('demo', task.id), /already has this commit/);
});

test('the PR draft is written after review and shown at the gate, a failed draft does not block', async () => {
  const brokenDraft: Script = () => ({ text: 'not json', costUsd: 0.01 });
  const { driver, store, task, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
    prWriter: [brokenDraft],
  });
  const reviewed = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(reviewed.stage, 'awaiting-approval');
  assert.equal(reviewed.pr_draft, undefined);
  assert.equal((await store.read('demo', task.id)).attempts?.at(-1)?.outcome, 'failed');

  const drafted = await driver.draftPr('demo', task.id);
  const gate = await driver.gate('demo', task.id);
  assert.equal(drafted.pr_draft?.head_sha, gate.headSha);
  await driver.approve('demo', task.id, { head: gate.headSha });
  await driver.openPr('demo', task.id);
  assert.equal(prs[0]?.title, 'Add the feature file');
});

test('a draft written for an older commit is not used', async () => {
  const { driver, task, prs } = await setup({
    classifier: [ready],
    coder: [
      writeFeature,
      async (r) => (await writeFile(join(r.cwd!, 'feature.txt'), 'v2\n'), { text: 'ok', costUsd: 0.1 }),
    ],
    reviewer: [approveReview, approveReview],
    prWriter: [defaultDraft, () => ({ text: '', costUsd: 0.01 })],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  await driver.revise('demo', task.id, 'make it v2', { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  assert.notEqual(gate.task.pr_draft?.head_sha, gate.headSha);
  await driver.approve('demo', task.id, { head: gate.headSha });
  await driver.openPr('demo', task.id);
  assert.notEqual(prs[0]?.title, 'Add the feature file');
  // Without a draft for this commit the body still keeps the factory template's headings.
  assert.match(prs[0]!.body, /^## Summary\n\nLooks right\./);
  assert.match(prs[0]!.body, /## Evidence\n[\s\S]*## Merge Danger\n/);
});

test('a draft that leaves out a template heading is asked again, and refused after a second miss', async () => {
  const partial: Script = () => ({
    text: '',
    structured: { title: 'Add the feature file', body: '## Summary\n\nAdds it.' },
    costUsd: 0.01,
  });
  const ok = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
    prWriter: [partial, defaultDraft],
  });
  const drafted = await ok.driver.run('demo', ok.task.id, { maxAttempts: 1 });
  assert.equal(drafted.pr_draft?.title, 'Add the feature file');
  assert.equal((drafted.pr_draft as { template?: string }).template, 'factory');
  const retry = ok.runner.calls.filter((c) => c.step === 'pr-writer').at(-1)!;
  assert.match(retry.prompt, /left out these template headings: Evidence, Merge Danger/);

  const bad = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
    prWriter: [partial, partial],
  });
  const refused = await bad.driver.run('demo', bad.task.id, { maxAttempts: 1 });
  assert.equal(refused.stage, 'awaiting-approval', 'a refused draft does not block the gate');
  assert.equal(refused.pr_draft, undefined);
});

test("the repository's own PR template wins over the factory's", async () => {
  const own: Script = () => ({
    text: '',
    structured: { title: 'Add the feature file', body: '## What\n\nAdds it.\n\n## Why\n\nAsked for.' },
    costUsd: 0.01,
  });
  const ctx = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
    prWriter: [own],
  });
  const repo = ctx.repo;
  await mkdir(join(repo, '.github'), { recursive: true });
  await writeFile(
    join(repo, '.github', 'pull_request_template.md'),
    '## What\n\n<!-- the change -->\n\n## Why\n',
  );
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'template'], {
    cwd: repo,
  });
  const drafted = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 1 });
  assert.equal((drafted.pr_draft as { template?: string }).template, '.github/pull_request_template.md');
  const call = ctx.runner.calls.find((c) => c.step === 'pr-writer')!;
  assert.match(call.prompt, /<template source="\.github\/pull_request_template\.md">\n## What/);
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

test('ready research tasks stop before creating a worktree or coding', async () => {
  const research: Script = (r) => ({
    text: '',
    structured: {
      intake_id: /"id": "([^"]+)"/.exec(r.prompt)![1],
      kind: 'research',
      loe: 'S',
      readiness: 'ready',
      blockers: [],
    },
    costUsd: 0,
  });
  const { driver, task, runner } = await setup({ classifier: [research] });
  const result = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(result.stage, 'blocked');
  assert.equal(result.worktree, undefined);
  assert.match(result.events!.at(-1)!.message, /Research workflow is not available/);
  assert.equal(runner.calls.length, 1);
  await assert.rejects(driver.prepareWorktree('demo', task.id), /not ready to code/);
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
  await driver.approve('demo', task.id, { head: first.headSha });
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

test('verification rejects more than 400 non-test changed lines', async () => {
  const writeLarge: Script = async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'line\n'.repeat(401));
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task, store } = await setup({ classifier: [ready], coder: [writeLarge] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  assert.match((await store.read('demo', task.id)).verification!.output_tail, /401 non-test lines/);
});

test('verification refuses a change that weakens tests, unless a person allowed test changes', async () => {
  const writeSkipped: Script = async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'line\n');
    await writeFile(join(r.cwd!, 'feature.test.ts'), "test.skip('feature', () => {});\n");
    return { text: 'ok', costUsd: 0.1 };
  };
  const refused = await setup({ classifier: [ready], coder: [writeSkipped] });
  await assert.rejects(
    refused.driver.run('demo', refused.task.id, { maxAttempts: 1 }),
    /verification still failing/,
  );
  assert.match(
    (await refused.store.read('demo', refused.task.id)).verification!.output_tail,
    /weakens tests: skips or focuses a test in feature\.test\.ts/,
  );

  const allowed = await setup({ classifier: [ready], coder: [writeSkipped], reviewer: [approveReview] });
  await allowed.store.write({
    ...(await allowed.store.read('demo', allowed.task.id)),
    allow_test_changes: true,
  });
  assert.equal(
    (await allowed.driver.run('demo', allowed.task.id, { maxAttempts: 1 })).stage,
    'awaiting-approval',
  );
});

test('test lines do not count toward the 400 line limit', async () => {
  const writeTests: Script = async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'line\n'.repeat(400));
    await writeFile(join(r.cwd!, 'feature.test.ts'), 'test\n'.repeat(500));
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task } = await setup({
    classifier: [ready],
    coder: [writeTests],
    reviewer: [approveReview],
  });
  assert.equal((await driver.run('demo', task.id, { maxAttempts: 1 })).stage, 'awaiting-approval');
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

test('verification rejects profile-defined generated output', async () => {
  const writeOutput: Script = async (r) => {
    await writeFile(join(r.cwd!, 'bundle.js'), 'generated');
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task, store } = await setup(
    { classifier: [ready], coder: [writeOutput] },
    'true',
    '[bundle.js]',
  );
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  assert.match((await store.read('demo', task.id)).verification!.output_tail, /generated files: bundle\.js/);
});

/** A task whose worktree exists, with `files` already on main (the profile protects only secrets/). */
async function withWorktree(files: Record<string, string> = {}) {
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

test('verification fails a rename out of .github/workflows, with a profile that does not list it', async () => {
  const { driver, task, path, commit } = await withWorktree({ '.github/workflows/ci.yml': 'name: ci\n' });
  sh(path, 'mv', '.github/workflows/ci.yml', 'ci.yml');
  await writeFile(join(path, 'feature.txt'), 'done\n');
  commit('move ci');
  const result = await driver.verify('demo', task.id);
  assert.equal(result.passed, false);
  assert.match(result.output, /protected paths: .*\.github\/workflows\/ci\.yml/);
});

test('verification fails .GitHub/actions and CODEOWNERS in any folder', async () => {
  for (const file of ['.GitHub/actions/x.yml', 'docs/CODEOWNERS', '.husky/pre-push', '.env.local']) {
    const { driver, task, path, commit } = await withWorktree();
    execFileSync('mkdir', ['-p', join(path, file, '..')]);
    await writeFile(join(path, file), 'x\n');
    await writeFile(join(path, 'feature.txt'), 'done\n');
    commit('add protected file');
    const result = await driver.verify('demo', task.id);
    assert.equal(result.passed, false, file);
    assert.ok(result.output.includes(file), `${file}: ${result.output}`);
  }
});

test('a commit the agent made itself, with nothing staged, fails verification on a protected path', async () => {
  const sneaky: Script = async (r) => {
    execFileSync('mkdir', ['-p', join(r.cwd!, '.github', 'actions', 'setup')]);
    await writeFile(join(r.cwd!, '.github', 'actions', 'setup', 'action.yml'), 'runs: {}\n');
    await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
    sh(r.cwd!, 'add', '-A');
    sh(r.cwd!, 'commit', '-qm', 'agent commit');
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task, store } = await setup({ classifier: [ready], coder: [sneaky] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'verification-failed');
  assert.match(stored.verification!.output_tail, /protected paths: \.github\/actions\/setup\/action\.yml/);
});

test('the coder guard refuses built-in protected paths for Edit and Write, in any letter case', async () => {
  let denials: (string | undefined)[] = [];
  const probe: Script = async (r) => {
    denials = [
      r.guard!.check('Write', { file_path: join(r.cwd!, '.github/actions/x/action.yml') }),
      r.guard!.check('Edit', { file_path: join(r.cwd!, '.Husky/pre-push') }),
      r.guard!.check('Write', { file_path: join(r.cwd!, 'docs/CODEOWNERS') }),
      r.guard!.check('Write', { file_path: join(r.cwd!, 'feature.txt') }),
    ];
    return writeFeature(r);
  };
  const { driver, task } = await setup({ classifier: [ready], coder: [probe], reviewer: [approveReview] });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.ok(denials[0] && denials[1] && denials[2]);
  assert.equal(denials[3], undefined);
});

test('a person can allow protected paths for one task; the gate record names them', async () => {
  const { driver, task, store, path, commit } = await withWorktree();
  execFileSync('mkdir', ['-p', join(path, '.github', 'workflows')]);
  await writeFile(join(path, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  await writeFile(join(path, 'feature.txt'), 'done\n');
  commit('add workflow');
  assert.equal((await driver.verify('demo', task.id)).passed, false);
  await store.write({ ...(await store.read('demo', task.id)), allow_protected_paths: true });
  const result = await driver.verify('demo', task.id);
  assert.equal(result.passed, true);
  assert.deepEqual(result.protectedPathsAllowed, ['.github/workflows/ci.yml']);
  assert.match(result.output, /allowed protected paths.*\.github\/workflows\/ci\.yml/);
  // The profile's own forbidden paths stay forbidden.
  execFileSync('mkdir', ['-p', join(path, 'secrets')]);
  await writeFile(join(path, 'secrets', 'k'), 'x');
  commit('add secret');
  assert.match((await driver.verify('demo', task.id)).output, /protected paths: secrets\/k/);
});

test('verification retains only the output tail while forwarding the complete log', async () => {
  const { driver, task } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.classify('demo', task.id);
  await driver.prepareWorktree('demo', task.id);
  let streamed = 0;
  driver.deps.log = (chunk) => {
    streamed += chunk.length;
  };
  driver.deps.shell.runShell = async (_command, options) => {
    assert.equal(options.captureLimit, 0);
    for (let i = 0; i < 1000; i++) options.onOutput?.('x'.repeat(1000));
    options.onOutput?.('failure-end');
    return { code: 1, stdout: '', stderr: '' };
  };
  const result = await driver.verify('demo', task.id);
  assert.equal(result.passed, false);
  assert.ok(streamed > 1_000_000);
  assert.ok(result.output.length <= 6001);
  assert.match(result.output, /failure-end/);
});

test('running an already reviewed or approved task cannot spend on more model calls', async () => {
  const { driver, task, runner } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const calls = runner.calls.length;
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /cannot be run/);
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /cannot be run/);
  assert.equal(runner.calls.length, calls);
});

test('classification persists the verdict and attempt in one write', async () => {
  const { driver, task, store } = await setup({ classifier: [ready] });
  let writes = 0;
  driver.deps.tasks = {
    read: store.read.bind(store),
    worktreePath: store.worktreePath.bind(store),
    write: async (record) => {
      writes++;
      await store.write(record);
    },
  };
  const classified = await driver.classify('demo', task.id);
  assert.equal(writes, 1);
  assert.equal(classified.verdict?.readiness, 'ready');
  assert.equal(classified.attempts?.[0]?.step, 'classifier');
});

test('verification cannot pass for a commit changed by the check command', async () => {
  const { driver, task, store } = await setup(
    { classifier: [ready], coder: [writeFeature] },
    'test -f feature.txt && git -c user.name=test -c user.email=test@example.com commit --allow-empty -qm changed-during-check',
  );
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /verification still failing/);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'verification-failed');
  assert.equal(stored.verification?.passed, false);
  assert.match(stored.verification!.output_tail, /commit changed during verification/);
});

test('revision preflight failure leaves neither approval nor an approved stage', async () => {
  const { driver, task, runner, store } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  const calls = runner.calls.length;
  const broken = new Driver({
    ...driver.deps,
    readProfile: async () => {
      throw new Error('profile unavailable');
    },
  });
  await assert.rejects(
    broken.revise('demo', task.id, 'change it', { maxAttempts: 1 }),
    /profile unavailable/,
  );
  const failed = await store.read('demo', task.id);
  assert.equal(failed.stage, 'failed');
  assert.equal(failed.approval, undefined);
  assert.equal(runner.calls.length, calls);
  await assert.rejects(driver.openPr('demo', task.id), /approved/);
});

/** Gives the profile spending and time limits, as a repository owner would in profile.yaml. */
function withLimits(driver: Driver, limits: Record<string, number>) {
  const read = driver.deps.readProfile;
  driver.deps.readProfile = async (p) => ({ ...(await read(p)), limits });
}

test('every model call gets the step limits, the task budget left and the run signal', async () => {
  const { driver, task, runner } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  const controller = new AbortController();
  driver.deps.signal = controller.signal;
  withLimits(driver, { task_budget_usd: 3 });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  for (const call of runner.calls) {
    assert.equal(call.signal, controller.signal);
    assert.equal(call.timeoutMs, 60 * 60_000);
    assert.equal(call.stallMs, 20 * 60_000);
  }
  // The classifier spent $0.001 of $3, so the coder may spend its own $5 limit only up to what is left.
  assert.equal(runner.calls.find((c) => c.tools === 'edit')?.maxBudgetUsd, 3 - 0.001);
});

test('the ladder stops when the task budget is spent, and says how to continue', async () => {
  const costly: Script = async (r) => (
    await writeFile(join(r.cwd!, 'other.txt'), 'x\n'),
    { text: 'ok', costUsd: 0.5 }
  );
  const { driver, store, task, runner } = await setup({
    classifier: [ready],
    coder: [costly, costly, costly],
  });
  withLimits(driver, { task_budget_usd: 0.6 });
  await assert.rejects(
    driver.run('demo', task.id, { maxAttempts: 3 }),
    /Task budget reached \(\$1\.00 spent\)/,
  );
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 2);
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'failed');
  assert.match(stored.events!.at(-1)!.message, /limits\.task_budget_usd/);
});

test('the coder may delegate: it gets a grant for its worktree, and child costs join its attempt', async () => {
  const grants: { label: string; cwd: string; access: string; budgetUsd: number; guard?: unknown }[] = [];
  let revoked = 0;
  const { driver, store, task, runner } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  driver.deps.delegation = {
    grant: (options) => (
      grants.push(options),
      {
        endpoint: { url: 'http://127.0.0.1:1/mcp', token: 't' },
        spent: () => 0.25,
        revoke: () => void revoked++,
      }
    ),
  };
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const coder = runner.calls.find((c) => c.tools === 'edit')!;
  assert.deepEqual(coder.mcp, { url: 'http://127.0.0.1:1/mcp', token: 't' });
  assert.equal(grants.length, 1, 'only the coder may start children');
  assert.equal(grants[0]!.cwd, coder.cwd);
  assert.equal(grants[0]!.access, 'edit');
  assert.equal(grants[0]!.guard, coder.guard, 'children inherit the coder guard');
  assert.equal(revoked, 1);
  const attempt = (await store.read('demo', task.id)).attempts!.find((a) => a.step === 'coder')!;
  assert.equal(attempt.cost_usd, 0.1 + 0.25);
  assert.equal(runner.calls.filter((c) => c.mcp).length, 1);
});

test('tool-using steps get confirmed repository facts, the loop guard and the project context limit', async () => {
  const { driver, task, runner } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  driver.deps.repositoryFacts = async () =>
    '## What earlier sessions learned about this repository\n\n- [f1] Run build first.';
  driver.deps.contextLimits = async () => ({ default: 100_000, 'claude-opus-5-5': 180_000 });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const classifier = runner.calls.find((c) => c.tools === 'none')!;
  assert.doesNotMatch(classifier.systemPrompt, /earlier sessions/, 'a step without tools gets no facts');
  for (const call of runner.calls.filter((c) => c.tools !== 'none')) {
    assert.match(call.systemPrompt, /\[f1\] Run build first\./);
    assert.equal(call.loopGuard, true);
    assert.equal(call.context?.limit, call.model === 'claude-opus-5-5' ? 180_000 : 100_000);
  }
});

test('the setup command runs once per worktree; a failure stops before any model call and a rerun retries it', async () => {
  const withSetup = (driver: Driver, command: string) => {
    const read = driver.deps.readProfile;
    driver.deps.readProfile = async (p) => {
      const profile = await read(p);
      return { ...profile, commands: { ...profile.commands, setup: command } };
    };
  };
  const { driver, task, runner, store } = await setup({
    classifier: [ready, ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  withSetup(driver, 'test -f .ok-to-install && echo installed >> setup.log');
  await assert.rejects(
    driver.run('demo', task.id, { maxAttempts: 1 }),
    /Worktree setup .* exited with status 1/,
  );
  assert.equal(
    runner.calls.filter((c) => c.tools === 'edit').length,
    0,
    'no coder call after a failed setup',
  );
  assert.equal((await store.read('demo', task.id)).stage, 'failed');
  const path = (await store.read('demo', task.id)).worktree!.path;
  // setup.log is untracked output; ignore it so verification stays clean.
  await writeFile(join(path, '.ok-to-install'), '');
  await git.excludeLocally(path, 'setup.log');
  await git.excludeLocally(path, '.ok-to-install');
  const after = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.ok(after.worktree!.setup_at);
  assert.equal(after.stage, 'awaiting-approval');
  assert.equal(
    (await readFile(join(path, 'setup.log'), 'utf8')).trim(),
    'installed',
    'setup ran exactly once',
  );
});

test('a revision after a failed setup runs the setup again before the coder', async () => {
  const { driver, task, runner, store } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  const read = driver.deps.readProfile;
  driver.deps.readProfile = async (p) => {
    const profile = await read(p);
    return {
      ...profile,
      commands: { ...profile.commands, setup: 'test -f .ok-to-install && echo installed >> setup.log' },
    };
  };
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /Worktree setup/);
  await assert.rejects(
    driver.revise('demo', task.id, 'try again', { maxAttempts: 1 }),
    /Worktree setup .* exited with status 1/,
  );
  assert.equal(
    runner.calls.filter((c) => c.tools === 'edit').length,
    0,
    'no coder call while setup still fails',
  );
  const path = (await store.read('demo', task.id)).worktree!.path;
  await writeFile(join(path, '.ok-to-install'), '');
  await git.excludeLocally(path, 'setup.log');
  await git.excludeLocally(path, '.ok-to-install');
  const revised = await driver.revise('demo', task.id, 'try again', { maxAttempts: 1 });
  assert.ok(revised.worktree!.setup_at);
  assert.equal(revised.stage, 'awaiting-approval');
  assert.equal((await readFile(join(path, 'setup.log'), 'utf8')).trim(), 'installed');
});

test('a coder that makes no changes fails with its last message, so the reason is visible', async () => {
  const idle: Script = () => ({
    text: 'I could not update anything: the registry at codeartifact is not reachable from the sandbox.',
    costUsd: 0.3,
  });
  const { driver, task, store } = await setup({ classifier: [ready], coder: [idle] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /coder made no changes/);
  const stored = await store.read('demo', task.id);
  const failed = stored.events!.at(-1)!;
  assert.equal(failed.kind, 'stage:failed');
  assert.equal(failed.message.split('\n')[0], 'coder made no changes');
  assert.match(failed.message, /\nCoder's last message:\n[\s\S]*registry at codeartifact is not reachable/);
  assert.match(stored.attempts!.at(-1)!.error!, /registry at codeartifact is not reachable/);
});

/** Overrides profile fields for one test driver. */
function withProfile(driver: Driver, change: (profile: RepoProfile) => RepoProfile) {
  const read = driver.deps.readProfile;
  driver.deps.readProfile = async (p) => change(await read(p));
}

test('a failed preflight check stops a run and a revision before any model call, and names the fix', async () => {
  const { driver, task, runner, store } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  const marker = join(await mkdtemp(join(tmpdir(), 'factory-preflight-')), 'signed-in');
  withProfile(driver, (profile) => ({
    ...profile,
    preflight: [{ name: 'AWS SSO', run: `test -f ${marker}`, fix: `touch ${marker}` }],
  }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /Preflight check "AWS SSO" failed/);
  assert.equal(runner.calls.length, 0, 'no classifier or coder call');
  const failed = await store.read('demo', task.id);
  assert.equal(failed.stage, 'failed');
  assert.equal(failed.worktree, undefined, 'no worktree was created');
  assert.match(failed.events!.at(-1)!.message, new RegExp(`Fix: \`touch ${marker}\``));
  await writeFile(marker, '');
  const done = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(done.stage, 'awaiting-approval');
  await rm(marker);
  await assert.rejects(
    driver.revise('demo', task.id, 'more', { maxAttempts: 1 }),
    /Preflight check "AWS SSO" failed/,
  );
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 1, 'no coder call for the revision');
});

test('an environment failure in verification stops the ladder instead of trying a stronger model', async () => {
  const { driver, task, runner, store } = await setup(
    { classifier: [ready], coder: [writeFeature, writeFeature, writeFeature] },
    "echo 'connect ECONNREFUSED 127.0.0.1:5432' && exit 1",
  );
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 3 }), /environment/);
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 1, 'one coder attempt only');
  const stored = await store.read('demo', task.id);
  assert.equal(stored.stage, 'failed');
  const message = stored.events!.at(-1)!.message;
  assert.match(message.split('\n')[0]!, /a network service is not reachable/);
  assert.match(message, /ECONNREFUSED 127\.0\.0\.1:5432/);
});

test('a check that refuses the change as too broad is left to CI, and the task says so', async () => {
  const { driver, task, runner } = await setup(
    { classifier: [ready], coder: [writeFeature], reviewer: [approveReview] },
    "echo 'test:changed: this diff affects 80 workspaces (limit 6), too broad to run on this machine.' && exit 1",
  );
  const reviewed = await driver.run('demo', task.id, { maxAttempts: 3 });
  assert.equal(reviewed.stage, 'awaiting-approval');
  assert.equal(reviewed.verification?.passed, true);
  assert.deepEqual(reviewed.verification?.not_run_locally, ['test']);
  assert.match(
    reviewed.verification!.output_tail,
    /\[test not run locally: .*too broad.* CI must pass before merge\.\]/,
  );
  assert.ok(reviewed.events!.some((e) => /not run locally: test \(CI must pass\)/.test(e.message)));
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 1, 'no second coder attempt');
});

test('a real failure in a later check still fails verification after a too-broad check', async () => {
  const { driver, task } = await setup(
    { classifier: [ready], coder: [writeFeature] },
    "echo 'too broad to run on this machine.' && exit 1",
  );
  withProfile(driver, (profile) => ({
    ...profile,
    commands: { ...profile.commands, full_check: "echo 'lint: 2 errors' && exit 1" },
  }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }));
  const verdict = await driver.verify('demo', task.id);
  assert.equal(verdict.passed, false);
  assert.match(verdict.output, /\[full_check exited with status 1\]/);
});

test('a profile environment pattern also stops the ladder', async () => {
  const { driver, task, runner } = await setup(
    { classifier: [ready], coder: [writeFeature, writeFeature] },
    "echo 'mdm sandbox is down' && exit 1",
  );
  withProfile(driver, (profile) => ({ ...profile, environment_errors: ['sandbox is down'] }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 2 }), /environment/);
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 1);
});

test('setup runs again when the coder changes a lockfile, and a failed rerun goes back to the coder', async () => {
  const logDir = await mkdtemp(join(tmpdir(), 'factory-setup-'));
  const log = join(logDir, 'setup.log');
  const brokenLock: Script = async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
    await writeFile(join(r.cwd!, 'pnpm-lock.yaml'), 'broken\n');
    return { text: 'ok', costUsd: 0.1 };
  };
  let feedback = '';
  const fixedLock: Script = async (r) => {
    feedback = r.prompt;
    await writeFile(join(r.cwd!, 'pnpm-lock.yaml'), 'lockfileVersion: valid\n');
    return { text: 'ok', costUsd: 0.1 };
  };
  const { driver, task } = await setup({
    classifier: [ready],
    coder: [brokenLock, fixedLock],
    reviewer: [approveReview],
  });
  withProfile(driver, (profile) => ({
    ...profile,
    commands: {
      ...profile.commands,
      setup: `echo run >> ${log} && { test ! -f pnpm-lock.yaml || grep -q valid pnpm-lock.yaml; }`,
    },
  }));
  const done = await driver.run('demo', task.id, { maxAttempts: 2 });
  assert.equal(done.stage, 'awaiting-approval');
  assert.match(feedback, /setup/i, 'the failed setup output reached the next coder attempt');
  assert.equal(
    (await readFile(log, 'utf8')).trim().split('\n').length,
    3,
    'setup ran for the new worktree, then after each lockfile change',
  );
  assert.ok(done.worktree!.setup_key, 'the setup inputs are recorded');
});

test('the coder gets a short-lived registry token in its own npmrc and the profile env, never in the log', async () => {
  let seen: { env?: Record<string, string>; npmrc?: string } = {};
  const probe: Script = async (r) => {
    seen = { env: r.env, npmrc: await readFile(r.env!.NPM_CONFIG_USERCONFIG!, 'utf8') };
    return writeFeature(r);
  };
  const { driver, task, store } = await setup({
    classifier: [ready],
    coder: [probe],
    reviewer: [approveReview],
  });
  const lines: string[] = [];
  driver.deps.log = (line) => void lines.push(line);
  withProfile(driver, (profile) => ({
    ...profile,
    sandbox: {
      allowed_domains: ['registry.example.test'],
      env: { CODEARTIFACT_TOKEN_STAGED: '1' },
      npm_tokens: [{ registry: '//registry.example.test/npm/mdm/', command: 'echo tok-123' }],
    },
  }));
  await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(seen.env!.CODEARTIFACT_TOKEN_STAGED, '1');
  assert.equal(seen.npmrc, '//registry.example.test/npm/mdm/:_authToken=tok-123\n');
  assert.equal(existsSync(seen.env!.NPM_CONFIG_USERCONFIG!), false, 'the npmrc is removed after the call');
  const stored = JSON.stringify(await store.read('demo', task.id));
  assert.ok(
    !stored.includes('tok-123') && !lines.join('\n').includes('tok-123'),
    'the token is never recorded',
  );
});

test('a registry token that cannot be minted fails the task before the coder, as an environment fault', async () => {
  const { driver, task, runner, store } = await setup({ classifier: [ready], coder: [writeFeature] });
  withProfile(driver, (profile) => ({
    ...profile,
    sandbox: {
      npm_tokens: [
        {
          registry: '//registry.example.test/npm/mdm/',
          command: "echo 'Error when retrieving token from sso: Token has expired' >&2; exit 255",
        },
      ],
    },
  }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /registry token/);
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 0);
  const failed = (await store.read('demo', task.id)).events!.at(-1)!;
  assert.equal(failed.kind, 'stage:failed');
  assert.match(failed.message, /\/\/registry\.example\.test\/npm\/mdm\//);
  assert.match(failed.message, /Token has expired/);
});

test('a setup or check that prints nothing for the stall limit is stopped and says so', async () => {
  const { driver, task, runner, store } = await setup(
    { classifier: [ready], coder: [writeFeature] },
    'echo testing; sleep 30',
  );
  withProfile(driver, (profile) => ({
    ...profile,
    commands: { ...profile.commands, setup: 'echo installing; sleep 30' },
    limits: { ...profile.limits, check_stall_minutes: 0.01 },
  }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /printed nothing for 1 second/);
  assert.equal(runner.calls.filter((c) => c.tools === 'edit').length, 0);
  assert.match((await store.read('demo', task.id)).events!.at(-1)!.message, /installing/);
  withProfile(driver, (profile) => ({ ...profile, commands: { ...profile.commands, setup: 'true' } }));
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }));
  assert.match(
    (await store.read('demo', task.id)).verification!.output_tail,
    /\[test printed nothing for 1 second and was stopped\]/,
  );
});

test('the profile check runs preflight, setup and the checks in a temporary worktree, with no model call', async () => {
  const { driver, repo, runner } = await setup({}, 'test -f README.md');
  withProfile(driver, (profile) => ({
    ...profile,
    preflight: [{ name: 'Login', run: 'true' }],
    commands: { ...profile.commands, setup: 'echo installing' },
  }));
  const result = await driver.checkProfile('demo', repo);
  assert.equal(result.passed, true);
  assert.deepEqual(
    result.steps.map((s) => [s.name, s.outcome]),
    [
      ['Preflight: Login', 'passed'],
      ['Worktree from main', 'passed'],
      ['Setup', 'passed'],
      ['Test', 'passed'],
      ['Full check', 'passed'],
    ],
  );
  assert.match(result.steps[2]!.output, /installing/);
  assert.equal(runner.calls.length, 0);
  assert.equal(
    sh(repo, 'worktree', 'list').trim().split('\n').length,
    1,
    'the temporary worktree is removed',
  );
});

test('the profile check stops at the first failure, names environment faults and skips the rest', async () => {
  const { driver, repo } = await setup({});
  withProfile(driver, (profile) => ({
    ...profile,
    commands: { ...profile.commands, setup: "echo 'connect ECONNREFUSED 127.0.0.1:443'; exit 1" },
  }));
  const result = await driver.checkProfile('demo', repo);
  assert.equal(result.passed, false);
  assert.deepEqual(
    result.steps.map((s) => [s.name, s.outcome]),
    [
      ['Worktree from main', 'passed'],
      ['Setup', 'failed'],
      ['Test', 'skipped'],
      ['Full check', 'skipped'],
    ],
  );
  assert.equal(result.steps[1]!.environment, 'a network service is not reachable');
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 1);
});

test('a stacked task starts from its blocker branch and opens its PR only after the blocker is pushed', async () => {
  const first = await setup({
    classifier: [ready, ready],
    coder: [writeFeature, writeOther],
    reviewer: [approveReview, approveReview],
  });
  const { driver, store, task, repo } = first;
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const blocker = (await store.read('demo', task.id)).worktree!.branch;
  const second = await store.create(
    'demo',
    repo,
    'Add other.txt on top of feature.txt',
    new Date().toISOString(),
  );
  await store.write({ ...second, stack_on: blocker });
  const stacked = await driver.run('demo', second.id, { maxAttempts: 1 });
  assert.equal(stacked.worktree!.base_branch, blocker);
  assert.ok(
    existsSync(join(stacked.worktree!.path, 'feature.txt')),
    'the blocker change is in the stacked worktree',
  );
  assert.doesNotMatch(
    (await driver.gate('demo', second.id)).diffStat,
    /feature\.txt/,
    'the diff holds only its own change',
  );
  await driver.approve('demo', second.id, { head: (await driver.gate('demo', second.id)).headSha });
  await assert.rejects(
    driver.openPr('demo', second.id),
    /open the pull request of the blocking ticket first/,
  );
});

test('a failed model call keeps its reported cost, and a usage limit says when to run again', async () => {
  const limited: Script = () => {
    throw Object.assign(new Error("model run failed: You've hit your limit"), {
      costUsd: 0.3,
      kind: 'usage-limit',
    });
  };
  const { driver, store, task } = await setup({ classifier: [ready], coder: [limited] });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }));
  const stored = await store.read('demo', task.id);
  const coder = stored.attempts!.find((a) => a.step === 'coder')!;
  assert.equal(coder.cost_usd, 0.3);
  assert.match(coder.error!, /run the task again after it resets/);
});

test('after a reviewer failure, running again resumes at the reviewer without paying for the coder', async () => {
  const broken: Script = () => {
    throw new Error('model run failed: overloaded');
  };
  const { driver, task, runner } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [broken, approveReview],
  });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /overloaded/);
  const resumed = await driver.run('demo', task.id, { maxAttempts: 1 });
  assert.equal(resumed.stage, 'awaiting-approval');
  assert.deepEqual(
    runner.calls.map((c) => c.step),
    ['classifier', 'coder', 'reviewer', 'reviewer', 'pr-writer'],
  );
});

test('opening a PR adopts one that a lost write already opened, instead of opening a second', async () => {
  const { driver, task, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  const asked: string[] = [];
  driver.deps.github.pullRequestsFrom = async ({ head }) => (
    asked.push(head),
    [
      { url: 'https://github.com/example/demo/pull/3', state: 'CLOSED', head_sha: 'an-older-commit' },
      { url: 'https://github.com/example/demo/pull/9', state: 'OPEN', head_sha: gate.headSha },
    ]
  );
  const opened = await driver.openPr('demo', task.id);
  assert.equal(opened.pr?.url, 'https://github.com/example/demo/pull/9');
  assert.equal(opened.publication, undefined, 'the intent is cleared once the PR is recorded');
  assert.deepEqual(asked, [`factory/${task.id}`]);
  assert.equal(prs.length, 0);
});

test('a PR created but not recorded is found again on retry, and a closed one for the commit needs a person', async () => {
  const { driver, task, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  // The PR is created on GitHub, then the save that records it fails (a crash at that point).
  const write = driver.deps.tasks.write.bind(driver.deps.tasks);
  let failSave = true;
  driver.deps.tasks.write = async (record) => {
    if (record.pr && failSave) {
      failSave = false;
      throw new Error('disk full');
    }
    return write(record);
  };
  const github: { url: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; head_sha: string }[] = [];
  driver.deps.github.createPullRequest = async (o) => {
    prs.push(o);
    github.push({ url: 'https://github.com/example/demo/pull/1', state: 'OPEN', head_sha: gate.headSha });
    return 'https://github.com/example/demo/pull/1';
  };
  driver.deps.github.pullRequestsFrom = async () => github;
  await assert.rejects(driver.openPr('demo', task.id), /disk full/);
  const lost = await driver.deps.tasks.read('demo', task.id);
  assert.equal(lost.pr, undefined);
  assert.deepEqual([lost.publication?.step, lost.publication?.head_sha], ['create', gate.headSha]);

  const retried = await driver.openPr('demo', task.id);
  assert.equal(retried.pr?.url, 'https://github.com/example/demo/pull/1');
  assert.equal(prs.length, 1, 'the retry adopted the PR instead of opening a second');
  assert.equal(retried.publication, undefined);

  // Someone closed that PR; the task is approved again for the same commit and opened again.
  github[0]!.state = 'CLOSED';
  await driver.deps.tasks.write({ ...retried, pr: undefined, stage: 'approved' });
  await assert.rejects(driver.openPr('demo', task.id), /already exists and is closed: .*pull\/1.*Reopen it/);
  assert.equal(prs.length, 1, 'no second PR for the same commit');
});

test('the publication intent is saved before the push, so a failed push leaves a visible record', async () => {
  const { driver, task } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  driver.deps.git = {
    ...driver.deps.git,
    push: async () => {
      throw new Error('network down');
    },
  };
  await assert.rejects(driver.openPr('demo', task.id), /network down/);
  const record = await driver.deps.tasks.read('demo', task.id);
  assert.deepEqual([record.publication?.step, record.stage], ['push', 'approved']);
});

test('a commit made after the head check is not pushed: openPr sends the approved SHA only', async () => {
  const { driver, task, remote, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  const real = driver.deps.git;
  // After the head check, while openPr does its other async work, someone commits in the worktree.
  driver.deps.git = {
    ...real,
    isClean: async (dir) => {
      await writeFile(join(dir, 'late.txt'), 'late\n');
      sh(dir, 'add', 'late.txt');
      sh(dir, 'commit', '-qm', 'late commit nobody approved');
      return real.isClean(dir);
    },
  };
  const opened = await driver.openPr('demo', task.id);
  const branch = `factory/${task.id}`;
  assert.notEqual(sh(opened.worktree!.path, 'rev-parse', 'HEAD').trim(), gate.headSha, 'the branch moved');
  assert.equal(
    sh(remote, 'rev-parse', `refs/heads/${branch}`).trim(),
    gate.headSha,
    'origin has the approved SHA, not the moved branch tip',
  );
  assert.equal(opened.pr?.head_sha, gate.headSha);
  assert.equal(prs.length, 1);
});

test('a push that leaves another commit on the remote fails openPr and keeps the publication intent', async () => {
  const { driver, task, prs } = await setup({
    classifier: [ready],
    coder: [writeFeature],
    reviewer: [approveReview],
  });
  await driver.run('demo', task.id, { maxAttempts: 1 });
  const gate = await driver.gate('demo', task.id);
  await driver.approve('demo', task.id, { head: gate.headSha });
  // The push reports success, but origin's ref is not the approved SHA (a hook, a proxy, a concurrent push).
  driver.deps.git = { ...driver.deps.git, remoteHead: async () => 'f'.repeat(40) };
  await assert.rejects(driver.openPr('demo', task.id), /after the push, not the approved/);
  const record = await driver.deps.tasks.read('demo', task.id);
  assert.deepEqual([record.publication?.step, record.publication?.head_sha], ['push', gate.headSha]);
  assert.equal(record.pr, undefined);
  assert.equal(record.stage, 'approved');
  assert.equal(prs.length, 0, 'no pull request was opened');
});

test('a runtime check (Reticle) runs after full_check: yes passes, no fails, unknown passes for a human to check', async () => {
  const withRuntime = (driver: Driver, command: string) => {
    const read = driver.deps.readProfile;
    driver.deps.readProfile = async (p) => {
      const profile = await read(p);
      return { ...profile, commands: { ...profile.commands, runtime_check: command } };
    };
  };
  for (const [script, passed, verdict, note] of [
    [
      "echo '  ✗ Console error on /: boom'; echo 'verified: no — 1 fault(s)'; exit 1",
      false,
      'no',
      /fix each ✗ line/,
    ],
    ["echo 'verified: yes — 3 page(s)'", true, 'yes', undefined],
    [
      "mkdir -p .reticle && echo j > .reticle/session.json; echo 'verified: unknown'; exit 2",
      true,
      'unknown',
      /check the running app before approving/,
    ],
  ] as const) {
    const { driver, task } = await setup({ classifier: [ready], coder: [writeFeature] });
    withRuntime(driver, script);
    await driver.classify('demo', task.id);
    await driver.prepareWorktree('demo', task.id);
    await driver.code('demo', task.id, { name: 'r', model: 'claude-sonnet-5-5', effort: 'low' });
    const result = await driver.verify('demo', task.id);
    assert.equal(result.passed, passed, `${script}\n${result.output}`);
    assert.equal(result.runtime, verdict);
    if (note) assert.match(result.output, note);
  }
});

test('a check that runs past its time limit is stopped and fails verification', async () => {
  const { driver, task } = await setup({ classifier: [ready], coder: [writeFeature] }, 'sleep 30');
  withLimits(driver, { check_timeout_minutes: 0.005 });
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 1 }), /still failing/);
  const failed = await driver.deps.tasks.read('demo', task.id);
  assert.equal(failed.stage, 'verification-failed');
  assert.match(failed.verification!.output_tail, /test did not finish within 1 second and was stopped/);
});
