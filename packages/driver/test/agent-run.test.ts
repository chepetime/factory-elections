// An agent run with a scripted model: one guarded session, a driver commit, verify, no reviewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ModelResult, ModelRun, ModelRunner } from '@factory/core';
import * as fsAdapter from '@factory/adapters-fs';
import * as git from '@factory/adapters-git';
import { runShell } from '@factory/adapters-process';
import { Driver, type AgentSession, type DriverDeps } from '../src/index.ts';

const DEFS = resolve(import.meta.dirname, '..', '..', '..', 'definitions');
const paths = (n: string) => ({
  step: join(DEFS, 'steps', `${n}.yaml`),
  ladder: join(DEFS, 'ladders', `${n}.yaml`),
});

function sh(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function setup(
  turns: ((run: ModelRun) => Promise<ModelResult>)[],
  options: { prWriter?: boolean } = {},
) {
  const base = await mkdtemp(join(tmpdir(), 'factory-agent-run-'));
  const root = join(base, 'data');
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh(repo, 'config', 'user.name', 't');
  sh(repo, 'config', 'user.email', 't@example.com');
  await writeFile(join(repo, 'README.md'), '# demo\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'init');
  await new fsAdapter.ProjectStore(root).add('demo', repo);
  await writeFile(
    join(root, 'demo', 'profile.yaml'),
    [
      'project: demo',
      'approved_at: "2026-11-13"',
      'repo: { base_branch: { value: main, source: test } }',
      'commands: { test: "test -f feature.txt", full_check: "true" }',
      'confirmed: { forbidden_paths: [secrets/], forbidden_commands: [] }',
      'design_sources: []',
      'qa_targets: []',
    ].join('\n'),
  );
  const store = new fsAdapter.TaskStore(root);
  const created = await store.create('demo', repo, 'Add feature.txt', new Date().toISOString());
  const task = { ...created, workflow: 'agent' as const, agent: 'devin' };
  await store.write(task);
  const calls: ModelRun[] = [];
  const runner: ModelRunner = {
    run: async (r) => {
      calls.push(r);
      const next = turns.shift();
      if (!next) throw new Error('no scripted turn');
      return next(r);
    },
  };
  let status: 'in_review' | 'blocked' | undefined;
  let commented = false;
  const replies: (string | undefined)[] = [];
  let tick = 0;
  const deps: DriverDeps = {
    tasks: store,
    readProfile: (p) => fsAdapter.readProfile(root, p),
    git,
    shell: { runShell },
    github: {
      createPullRequest: async () => 'https://github.com/example/demo/pull/1',
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
      ...(options.prWriter ? { prWriter: paths('pr-writer') } : {}),
    },
    now: () => new Date(Date.UTC(2026, 10, 13, 0, 0, tick++)).toISOString(),
    log: () => {},
    agentSession: async (_task, reply): Promise<AgentSession> => {
      replies.push(reply);
      status = undefined;
      commented = false;
      return {
        name: 'Devin',
        model: 'claude-sonnet-5-5',
        effort: 'high',
        systemPrompt: 'You are Devin.',
        prompt: reply ?? 'Add feature.txt',
        budgetUsd: 5,
        passEnv: [],
        tools: [],
        reported: () => status,
        commented: () => commented,
      };
    },
  };
  return {
    driver: new Driver(deps),
    store,
    task,
    calls,
    replies,
    clear: () => (status = undefined),
    // A question is `blocked` with a comment; `blocked` alone is a bare status.
    block: (comment = true) => {
      status = 'blocked';
      commented = comment;
    },
  };
}

test('an agent run works in one guarded session, then the driver commits and verifies, with no reviewer', async () => {
  const { driver, store, task, calls } = await setup([
    async (r) => {
      await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
      return { text: 'Added it.', costUsd: 0.4, sessionId: 'sess-1' };
    },
  ]);
  const done = await driver.run('demo', task.id, { maxAttempts: 3 });
  assert.equal(done.stage, 'awaiting-approval');
  assert.equal(done.agent_session, 'sess-1');
  assert.equal(done.review, undefined, 'no reviewer step');
  assert.equal(done.verification?.passed, true);
  assert.equal(calls.length, 1, 'one model call: no classifier, no reviewer');
  const [call] = calls;
  assert.equal(call!.step, 'agent');
  assert.equal(call!.tools, 'edit');
  assert.equal(call!.persistSession, true);
  assert.ok(call!.guard, 'the coder guard screens every tool call');
  assert.match(call!.guard!.check('Bash', { command: 'git push origin HEAD' }) ?? '', /./, 'push is refused');
  assert.ok(call!.sandbox, 'the OS sandbox applies');
  const gate = await driver.gate('demo', task.id);
  assert.deepEqual(gate.blockers, []);
  assert.equal((await store.read('demo', task.id)).attempts?.at(-1)?.step, 'agent');
});

test('an agent that asks for help waits, and a reply resumes its session', async () => {
  const ctx = await setup([
    async () => {
      ctx.block();
      return { text: 'Which file name?', costUsd: 0.1, sessionId: 'sess-1' };
    },
    async (r) => {
      await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
      return { text: 'Done.', costUsd: 0.2, sessionId: 'sess-1' };
    },
  ]);
  const waiting = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(waiting.stage, 'blocked');
  assert.match(waiting.events!.at(-1)!.message, /Devin needs you/);

  const resumed = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(resumed.stage, 'awaiting-approval');
  assert.equal(ctx.calls[1]!.resume, 'sess-1', 'the same session continues');
});

test('an agent that changes a forbidden path fails and nothing is committed', async () => {
  const { driver, task } = await setup([
    async (r) => {
      execFileSync('mkdir', ['-p', join(r.cwd!, 'secrets')]);
      await writeFile(join(r.cwd!, 'secrets', 'key'), 'x\n');
      return { text: 'ok', costUsd: 0.1 };
    },
  ]);
  await assert.rejects(driver.run('demo', task.id, { maxAttempts: 3 }), /forbidden paths: secrets\/key/);
});

test('a dirty checkout does not block: the worktree starts from main, and uncommitted changes get a note', async () => {
  const { driver, task, calls } = await setup([
    async (r) => {
      await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
      return { text: 'Added it.', costUsd: 0.1, sessionId: 's' };
    },
  ]);
  // Another agent's untracked file and an uncommitted edit in the main checkout.
  await writeFile(join(task.repo, 'scratch.txt'), 'not mine\n');
  await writeFile(join(task.repo, 'README.md'), '# demo, edited\n');
  const done = await driver.run('demo', task.id, { maxAttempts: 3 });
  assert.equal(done.stage, 'awaiting-approval');
  const worktree = calls[0]!.cwd!;
  assert.equal(existsSync(join(worktree, 'scratch.txt')), false, 'untracked files stay in the checkout');
  assert.equal(
    await readFile(join(worktree, 'README.md'), 'utf8'),
    '# demo\n',
    'the worktree has the committed file',
  );
  const notes = done.events!.map((e) => e.message);
  assert.ok(notes.some((m) => /uncommitted changes \(README\.md\)/.test(m)));
  assert.ok(!notes.some((m) => m.includes('scratch.txt')), 'untracked files get no note');
});

test('a stopped session keeps its id, so your reply resumes the same agent memory', async () => {
  const ctx = await setup([
    async (r) => {
      r.onEvent?.({ type: 'session', id: 'sess-first' });
      throw Object.assign(new Error('model run stopped'), { kind: 'aborted', costUsd: 0.3 });
    },
    async (r) => {
      await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
      return { text: 'Done.', costUsd: 0.1, sessionId: 'sess-first' };
    },
  ]);
  await assert.rejects(ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 }));
  assert.equal((await ctx.store.read('demo', ctx.task.id)).agent_session, 'sess-first');
  await ctx.driver.revise('demo', ctx.task.id, 'Keep going', { maxAttempts: 3 });
  assert.equal(ctx.calls[1]!.resume, 'sess-first');
});

test('a run that never made a worktree can still be rejected', async () => {
  const { driver, task, store } = await setup([]);
  const rejected = await driver.reject('demo', task.id, 'Moved back to Todo from the task board.');
  assert.equal(rejected.stage, 'rejected');
  assert.equal(rejected.approval, undefined, 'no commit to record');
  assert.equal((await store.read('demo', task.id)).stage, 'rejected');
});

test("an agent run drafts its PR from the agent's report, in the template, before the gate", async () => {
  const { driver, task, calls } = await setup(
    [
      async (r) => {
        await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
        return { text: 'I added feature.txt because the test needs it.', costUsd: 0.4 };
      },
      async () => ({
        text: '',
        structured: {
          title: 'Add feature.txt for the check',
          body: '## Summary\n\nAdds it.\n\n## Evidence\n\n- **After:** test passes\n\n## Merge Danger\n\n**Door:** two-way',
        },
        costUsd: 0.05,
      }),
    ],
    { prWriter: true },
  );
  const done = await driver.run('demo', task.id, { maxAttempts: 3 });
  assert.equal(done.stage, 'awaiting-approval');
  assert.equal(done.pr_draft?.title, 'Add feature.txt for the check');
  const writer = calls.find((c) => c.step === 'pr-writer')!;
  assert.match(
    writer.prompt,
    /<agent-report>\nI added feature\.txt because the test needs it\.\n<\/agent-report>/,
  );
  assert.match(writer.prompt, /<template source="factory">/);
  assert.doesNotMatch(writer.prompt, /<review>/, 'an agent run has no reviewer');
});

const progress = (r: ModelRun) => {
  assert.ok(r.prompt);
  return { text: 'Tests still run; I commit next.', costUsd: 0.1, sessionId: 'sess-1' };
};

test('a turn that ends with a progress note gets one steer, and the steered turn reaches verification', async () => {
  const events: ModelRun['onEvent'][] = [];
  const ctx = await setup([
    async (r) => {
      events.push(r.onEvent);
      r.onEvent?.({
        type: 'tool',
        name: 'Bash',
        input: { command: 'pnpm test', run_in_background: true },
      });
      return progress(r);
    },
    async (r) => {
      await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
      return { text: 'Committed.', costUsd: 0.2, sessionId: 'sess-1' };
    },
  ]);
  const done = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(done.stage, 'awaiting-approval');
  assert.equal(ctx.calls.length, 2);
  assert.equal(ctx.calls[1]!.resume, 'sess-1', 'the steer resumes the same session');
  assert.match(ctx.calls[1]!.prompt, /^Your turn changed nothing\./);
  assert.match(ctx.calls[1]!.prompt, /pnpm test/, 'background work is named');
  assert.ok(ctx.calls[1]!.maxBudgetUsd! < 5 - 0.1 + 1e-9, 'the steer spends what the first turn left');
  const attempts = done.attempts!;
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]!.no_change_steered, true);
  assert.equal(attempts[1]!.no_change_steered, undefined, 'the steered turn changed something');
});

test("two turns with no change settle blocked, with the agent's last message", async () => {
  const ctx = await setup([
    async (r) => progress(r),
    async () => ({ text: 'Still nothing to commit.', costUsd: 0.1 }),
  ]);
  const blocked = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(blocked.stage, 'blocked');
  assert.equal(ctx.calls.length, 2, 'one steer, no more');
  const last = blocked.events!.at(-1)!.message;
  assert.match(last, /made no changes/);
  assert.match(last, /Still nothing to commit\./);
});

test('blocked with a comment is a question: it settles at once, with no steer', async () => {
  const ctx = await setup([
    async () => {
      ctx.block();
      return { text: 'Which file name?', costUsd: 0.1, sessionId: 'sess-1' };
    },
  ]);
  const blocked = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(blocked.stage, 'blocked');
  assert.equal(ctx.calls.length, 1);
  assert.match(blocked.events!.at(-1)!.message, /needs you/);
});

test('blocked with no comment gets the steer', async () => {
  const ctx = await setup([
    async () => {
      ctx.block(false);
      return { text: 'Waiting.', costUsd: 0.1, sessionId: 'sess-1' };
    },
    async (r) => {
      ctx.clear();
      await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
      return { text: 'Done.', costUsd: 0.1, sessionId: 'sess-1' };
    },
  ]);
  const done = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(ctx.calls.length, 2);
  assert.equal(done.stage, 'awaiting-approval');
});

test('a restart after a steer does not steer again', async () => {
  const ctx = await setup([
    async (r) => progress(r),
    // The steered turn fails mid-way: the run stops, as a crash or restart would.
    async () => {
      throw new Error('backend restarted');
    },
    async () => ({ text: 'Nothing more to do.', costUsd: 0.1, sessionId: 'sess-1' }),
  ]);
  await assert.rejects(ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 }), /backend restarted/);
  assert.equal((await ctx.store.read('demo', ctx.task.id)).attempts?.[0]?.no_change_steered, true);
  const again = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(again.stage, 'blocked', 'the next no-change turn settles');
  assert.equal(ctx.calls.length, 3, 'the third turn is the reply turn, not a second steer');
  assert.doesNotMatch(ctx.calls[2]!.prompt, /Your turn changed nothing/);
});
