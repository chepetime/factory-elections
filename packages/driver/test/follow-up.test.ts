// Follow-ups on a task whose PR is open, against a real git origin and a scripted agent: the agent
// continues the same branch, the change stops at the approval gate, and approval updates the same PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ModelResult, ModelRun, ModelRunner, TaskRecord } from '@factory/core';
import * as fsAdapter from '@factory/adapters-fs';
import * as git from '@factory/adapters-git';
import { runShell } from '@factory/adapters-process';
import { Driver, type AgentSession, type DriverDeps } from '../src/index.ts';

const DEFS = resolve(import.meta.dirname, '..', '..', '..', 'definitions');
const paths = (n: string) => ({
  step: join(DEFS, 'steps', `${n}.yaml`),
  ladder: join(DEFS, 'ladders', `${n}.yaml`),
});
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
type Turn = (run: ModelRun) => Promise<ModelResult>;

/** A task with an open PR: Devin's first run wrote feature.txt, a person approved it, the PR opened. */
async function opened(first: Turn = write('feature.txt', 'from devin\n')) {
  const base = await mkdtemp(join(tmpdir(), 'factory-follow-up-'));
  const root = join(base, 'data');
  const origin = join(base, 'origin.git');
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh(repo, 'config', 'user.name', 't');
  sh(repo, 'config', 'user.email', 't@example.com');
  await writeFile(join(repo, 'README.md'), '# demo\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'init');
  sh(repo, 'remote', 'add', 'origin', origin);
  sh(repo, 'push', '-q', 'origin', 'main');
  await new fsAdapter.ProjectStore(root).add('demo', repo);
  await writeFile(
    join(root, 'demo', 'profile.yaml'),
    [
      'project: demo',
      'approved_at: "2026-11-13"',
      'repo: { base_branch: { value: main, source: test } }',
      'commands: { test: "test -f feature.txt", full_check: "true" }',
      'confirmed: { forbidden_paths: [], forbidden_commands: [] }',
      'design_sources: []',
      'qa_targets: []',
    ].join('\n'),
  );
  const store = new fsAdapter.TaskStore(root);
  const created = await store.create('demo', repo, 'Add feature.txt', new Date().toISOString());
  const task = { ...created, workflow: 'agent' as const, agent: 'devin' };
  await store.write(task);
  const turns: Turn[] = [first];
  const calls: ModelRun[] = [];
  const runner: ModelRunner = {
    run: async (r) => {
      calls.push(r);
      const next = turns.shift();
      if (!next) throw new Error('no scripted turn');
      return next(r);
    },
  };
  const github: { url: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; head_sha: string }[] = [];
  let created_prs = 0;
  let tick = 0;
  const deps: DriverDeps = {
    tasks: store,
    readProfile: (p) => fsAdapter.readProfile(root, p),
    git,
    shell: { runShell },
    github: {
      createPullRequest: async () => {
        created_prs++;
        const url = `https://github.com/example/demo/pull/${created_prs}`;
        github.push({ url, state: 'OPEN', head_sha: 'set-after-push' });
        return url;
      },
      // GitHub may still list the old head right after a push.
      pullRequestsFrom: async () => github,
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
    steps: { classifier: paths('classifier'), coder: paths('coder'), reviewer: paths('reviewer') },
    now: () => new Date(Date.UTC(2026, 10, 13, 0, 0, tick++)).toISOString(),
    log: () => {},
    agentSession: async (t, reply): Promise<AgentSession> => ({
      name: t.agent === 'mika' ? 'Mika' : 'Devin',
      model: 'claude-sonnet-5-5',
      effort: 'high',
      systemPrompt: 'You are an agent.',
      prompt: reply ?? 'Add feature.txt',
      budgetUsd: 5,
      passEnv: [],
      tools: [],
      reported: () => undefined,
    }),
  };
  const driver = new Driver(deps);
  await driver.run('demo', task.id, { maxAttempts: 1 });
  await driver.approve('demo', task.id, { head: (await driver.gate('demo', task.id)).headSha });
  const pr = await driver.openPr('demo', task.id);
  github[0]!.head_sha = pr.pr!.head_sha;
  /** Commits `file` with `text` on origin's main, as another merged PR would. */
  const landOnMain = async (file: string, text: string) => {
    const other = join(base, `other-${tick}`);
    execFileSync('git', ['clone', '-q', origin, other]);
    sh(other, 'config', 'user.name', 'o');
    sh(other, 'config', 'user.email', 'o@example.com');
    await writeFile(join(other, file), text);
    sh(other, 'add', '.');
    sh(other, 'commit', '-qm', `land ${file}`);
    sh(other, 'push', '-q', 'origin', 'main');
  };
  const read = () => store.read('demo', task.id);
  const worktree = (t: TaskRecord) => t.worktree!.path;
  return { driver, task: pr, turns, calls, github, landOnMain, read, worktree, prs: () => created_prs };
}

function write(file: string, text: string): Turn {
  return async (r) => {
    await writeFile(join(r.cwd!, file), text);
    return { text: 'Done.', costUsd: 0.1 };
  };
}

test('a conflict follow-up hands the conflicts to the agent, stops at the gate, and approval updates the same PR', async () => {
  const ctx = await opened();
  await ctx.landOnMain('feature.txt', 'from main\n');
  ctx.turns.push(write('feature.txt', 'from devin and main\n'));
  const followed = await ctx.driver.followUp('demo', ctx.task.id, {
    note: 'Resolve the merge conflicts.',
    kind: 'conflicts',
    agent: 'devin',
    by: 'you',
  });
  assert.equal(followed.stage, 'awaiting-approval', 'the new commit waits for approval');
  assert.match(ctx.calls.at(-1)!.prompt, /Conflicted files:\n- feature\.txt/);
  assert.deepEqual(
    followed.follow_ups?.map((f) => [f.kind, f.agent, f.by]),
    [['conflicts', 'devin', 'you']],
  );
  const head = sh(ctx.worktree(followed), 'rev-parse', 'HEAD');
  assert.equal(
    sh(ctx.worktree(followed), 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length,
    3,
    'a merge commit',
  );
  assert.equal(followed.pr?.url, 'https://github.com/example/demo/pull/1', 'the PR stays the same');

  await ctx.driver.approve('demo', ctx.task.id, { head });
  const updated = await ctx.driver.openPr('demo', ctx.task.id);
  assert.equal(updated.stage, 'pr-opened');
  assert.deepEqual([updated.pr?.url, updated.pr?.head_sha], ['https://github.com/example/demo/pull/1', head]);
  assert.equal(ctx.prs(), 1, 'no second PR');
});

test('a conflict follow-up whose merge applies cleanly needs no agent and goes straight to the gate', async () => {
  const ctx = await opened();
  await ctx.landOnMain('other.txt', 'unrelated\n');
  const calls = ctx.calls.length;
  const followed = await ctx.driver.followUp('demo', ctx.task.id, {
    note: 'Resolve the merge conflicts.',
    kind: 'conflicts',
    agent: 'devin',
    by: 'factory',
    prHead: ctx.task.pr!.head_sha,
  });
  assert.equal(followed.stage, 'awaiting-approval');
  assert.equal(ctx.calls.length, calls, 'no model call');
  assert.equal(await readFile(join(ctx.worktree(followed), 'other.txt'), 'utf8'), 'unrelated\n');
});

test('conflict markers left by the agent are refused, and the merge is undone', async () => {
  const ctx = await opened();
  await ctx.landOnMain('feature.txt', 'from main\n');
  ctx.turns.push(async () => ({ text: 'I could not decide.', costUsd: 0.1 }));
  await assert.rejects(
    ctx.driver.followUp('demo', ctx.task.id, {
      note: 'Resolve.',
      kind: 'conflicts',
      agent: 'devin',
      by: 'you',
    }),
    /conflict markers remain in feature\.txt/,
  );
  const task = await ctx.read();
  assert.equal(task.stage, 'failed');
  assert.equal(await git.mergeInProgress(ctx.worktree(task)), false, 'the merge was aborted');
  assert.equal(await git.isClean(ctx.worktree(task)), true);
});

test('a follow-up that changes nothing leaves the PR as it was and the task done again', async () => {
  const ctx = await opened();
  ctx.turns.push(async () => ({ text: 'Nothing to change.', costUsd: 0.1 }));
  const followed = await ctx.driver.followUp('demo', ctx.task.id, {
    note: 'Check the copy.',
    kind: 'custom',
    agent: 'mika',
    by: 'you',
  });
  assert.equal(followed.stage, 'pr-opened');
  assert.equal(followed.agent, 'mika', 'the follow-up ran as the agent it named');
  assert.equal(followed.pr?.head_sha, ctx.task.pr?.head_sha);
});

test('a follow-up refuses a branch that diverged from the PR, and other commands still refuse an open PR', async () => {
  const ctx = await opened();
  const path = ctx.worktree(ctx.task);
  await writeFile(join(path, 'local.txt'), 'only here\n');
  sh(path, 'add', '.');
  sh(path, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'local');
  const pushed = join(path, 'pushed.txt');
  // Someone pushed a different commit to the PR branch.
  sh(path, 'checkout', '-q', '-b', 'tmp', 'origin/' + ctx.task.worktree!.branch);
  await writeFile(pushed, 'remote\n');
  sh(path, 'add', '.');
  sh(path, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'remote');
  sh(path, 'push', '-q', 'origin', `tmp:${ctx.task.worktree!.branch}`);
  sh(path, 'checkout', '-q', ctx.task.worktree!.branch);
  await assert.rejects(
    ctx.driver.followUp('demo', ctx.task.id, { note: 'Go.', kind: 'custom', agent: 'devin', by: 'you' }),
    /diverged from the pull request/,
  );
  // Every other command still refuses a task whose PR is open.
  await assert.rejects(
    ctx.driver.revise('demo', ctx.task.id, 'x', { maxAttempts: 1 }),
    /Add a follow-up instead/,
  );
});

test('a review follow-up pushes its fix to the same PR once the checks pass, and keeps a failing one', async () => {
  const ctx = await opened();
  ctx.turns.push(write('feature.txt', 'from devin, reviewed\n'));
  const pushed = await ctx.driver.followUp('demo', ctx.task.id, {
    note: '1. [must-fix] Handle the empty case',
    kind: 'review',
    agent: 'devin',
    by: 'factory',
  });
  assert.equal(pushed.stage, 'pr-opened', 'no approval gate for a review fix');
  assert.match(pushed.approval?.note ?? '', /review loop/);
  assert.equal(pushed.pr?.url, 'https://github.com/example/demo/pull/1');
  assert.notEqual(pushed.pr?.head_sha, ctx.task.pr?.head_sha, 'the PR has the fix');
  assert.equal(ctx.prs(), 1);

  // A fix that breaks the checks stays in the worktree and is not pushed.
  ctx.turns.push(async (r) => {
    await rm(join(r.cwd!, 'feature.txt'));
    return { text: 'Removed it.', costUsd: 0.1 };
  });
  const failed = await ctx.driver.followUp('demo', ctx.task.id, {
    note: '1. [must-fix] Remove the file',
    kind: 'review',
    agent: 'devin',
    by: 'factory',
  });
  assert.equal(failed.stage, 'verification-failed');
  assert.equal((await ctx.read()).pr?.head_sha, pushed.pr?.head_sha, 'the PR keeps the last good fix');
});

test('a follow-up gets the task budget again: the first run spent more than it, and the follow-up still runs', async () => {
  const ctx = await opened(async (r) => {
    await writeFile(join(r.cwd!, 'feature.txt'), 'from devin\n');
    return { text: 'Done.', costUsd: 6 };
  });
  ctx.turns.push(write('feature.txt', 'from devin, again\n'));
  const followed = await ctx.driver.followUp('demo', ctx.task.id, {
    note: 'Change the text.',
    kind: 'custom',
    agent: 'devin',
    by: 'you',
  });
  assert.equal(followed.stage, 'awaiting-approval', 'not blocked on the $5 budget');
  assert.match(ctx.calls.at(-1)!.prompt, /Change the text/);
});
