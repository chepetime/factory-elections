// An agent run with a scripted model: one guarded session, a driver commit, verify, no reviewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
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

async function setup(turns: ((run: ModelRun) => Promise<ModelResult>)[]) {
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
  let tick = 0;
  const deps: DriverDeps = {
    tasks: store,
    readProfile: (p) => fsAdapter.readProfile(root, p),
    git,
    shell: { runShell },
    github: { createPullRequest: async () => 'https://github.com/example/demo/pull/1' },
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
    agentSession: async (_task, reply): Promise<AgentSession> => {
      replies.push(reply);
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
