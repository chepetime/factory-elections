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
  const replies: (string | undefined)[] = [];
  const senders: (string | undefined)[] = [];
  const grants: {
    tools?: readonly { name: string; call(args: unknown): Promise<{ text: string; isError?: boolean }> }[];
  }[] = [];
  let tick = 0;
  const deps: DriverDeps = {
    tasks: store,
    readProfile: (p) => fsAdapter.readProfile(root, p),
    git,
    // These tests run real commands; the sandbox itself is covered in adapters-process.
    shell: { runShell: (command, options) => runShell(command, { ...options, sandbox: undefined }) },
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
    delegation: {
      grant: (options) => {
        grants.push(options);
        return undefined;
      },
    },
    agentSession: async (_task, reply, from): Promise<AgentSession> => {
      replies.push(reply);
      senders.push(from);
      status = undefined;
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
      };
    },
  };
  return {
    driver: new Driver(deps),
    store,
    task,
    calls,
    replies,
    senders,
    grants,
    block: () => (status = 'blocked'),
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

test('a failed verification goes back to the same agent session with the failure, and a fixed change reaches the gate', async () => {
  const ctx = await setup([
    async (r) => {
      await writeFile(join(r.cwd!, 'wrong.txt'), 'oops\n');
      return { text: 'Added it.', costUsd: 0.1, sessionId: 'sess-1' };
    },
    async (r) => {
      await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
      return { text: 'Fixed.', costUsd: 0.1, sessionId: 'sess-1' };
    },
  ]);
  const done = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(done.stage, 'awaiting-approval');
  assert.equal(ctx.calls.length, 2);
  assert.equal(ctx.calls[1]!.resume, 'sess-1', 'the agent keeps its memory of the work');
  assert.deepEqual(ctx.senders, [undefined, 'factory'], 'the fix turn comes from the factory, not a person');
  assert.match(ctx.replies[1]!, /exited with status 1/, 'the agent sees what failed');
  assert.match(ctx.replies[1]!, /check_change/, 'and how to check again before it stops');
  assert.ok(done.events!.some((e) => /Verification failed; Devin gets fix turn 1 of 2/.test(e.message)));
});

test('the factory gives at most two fix turns, then the task waits for a person', async () => {
  const ctx = await setup(
    [1, 2, 3].map((n) => async (r: ModelRun) => {
      await writeFile(join(r.cwd!, `wrong-${n}.txt`), 'oops\n');
      return { text: 'Tried.', costUsd: 0.1, sessionId: 'sess-1' };
    }),
  );
  const done = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(done.stage, 'verification-failed');
  assert.equal(ctx.calls.length, 3, 'the first turn and two fix turns');
});

test('an agent session gets a check_change tool that runs the size and test gates on its commits', async () => {
  const ctx = await setup([
    async (r) => {
      await writeFile(join(r.cwd!, 'feature.txt'), `${'line\n'.repeat(401)}`);
      execFileSync('git', ['add', '.'], { cwd: r.cwd! });
      execFileSync('git', ['commit', '-qm', 'big'], { cwd: r.cwd! });
      const tool = ctx.grants.at(-1)!.tools!.find((t) => t.name === 'check_change')!;
      const big = await tool.call({});
      assert.equal(big.isError, true);
      assert.match(big.text, /401 non-test lines; limit is 400/);
      assert.match(big.text, /feature\.txt \(401\)/, 'it names the largest files');
      await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
      execFileSync('git', ['commit', '-qam', 'small'], { cwd: r.cwd! });
      const small = await tool.call({});
      assert.equal(small.isError ?? false, false);
      assert.match(small.text, /passes the size and test gates/);
      return { text: 'Done.', costUsd: 0.1, sessionId: 'sess-1' };
    },
  ]);
  const done = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(done.stage, 'awaiting-approval');
});

test("new work starts from GitHub's base branch: local-only commits stay out, merged PRs are in", async () => {
  const ctx = await setup([
    async (r) => {
      await writeFile(join(r.cwd!, 'feature.txt'), 'done\n');
      return { text: 'Added it.', costUsd: 0.1, sessionId: 's' };
    },
  ]);
  const repo = ctx.task.repo;
  const remote = `${repo}-origin.git`;
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  sh(repo, 'remote', 'add', 'origin', remote);
  sh(repo, 'push', '-q', 'origin', 'main');
  // A PR merged on GitHub that the local checkout has not pulled.
  const other = `${repo}-other`;
  execFileSync('git', ['clone', '-q', remote, other]);
  sh(other, 'config', 'user.name', 't');
  sh(other, 'config', 'user.email', 't@example.com');
  await writeFile(join(other, 'merged.txt'), 'from GitHub\n');
  sh(other, 'add', '.');
  sh(other, 'commit', '-qm', 'merged on GitHub');
  sh(other, 'push', '-q', 'origin', 'main');
  // A commit on local main that was never pushed.
  await writeFile(join(repo, 'local.txt'), 'not pushed\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'local only');

  const done = await ctx.driver.run('demo', ctx.task.id, { maxAttempts: 3 });
  assert.equal(done.stage, 'awaiting-approval');
  const worktree = ctx.calls[0]!.cwd!;
  assert.equal(existsSync(join(worktree, 'merged.txt')), true, 'the merged PR is in');
  assert.equal(existsSync(join(worktree, 'local.txt')), false, 'the unpushed commit stays out');
  assert.match(done.events!.find((e) => e.kind === 'worktree')!.message, /from origin\/main at /);
  const tracked = (() => {
    try {
      return sh(worktree, 'config', '--get', `branch.factory/${ctx.task.id}.merge`).trim();
    } catch {
      return undefined; // exit 1: no such key
    }
  })();
  assert.equal(tracked, undefined, 'the task branch does not track main');
});
