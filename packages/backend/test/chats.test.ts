import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { storageFor } from '@factory/adapters-data';
import type { ModelRun } from '@factory/core';
import { AgentService, ChatService, repositoryReadGuard, DelegationServer } from '@factory/agents';
import { AgentPool, Executions } from '@factory/dispatcher';
import { Conflict } from '../src/conflict.ts';
import { IssueService } from '../src/issues.ts';

test('a chat resumes its session, shows the reply as it grows, refuses a second message, and creates tasks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-chats-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agents = new AgentService({ root, storage: storageFor(root), seed: true });
  const submitted: string[] = [];
  const issues = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => [] },
    settings: async () => ({
      task_manager: { kind: 'none' },
      tending: { enabled: false, answer_threads: false, trusted_logins: [] },
    }),
    submit: async ({ prompt }) => (submitted.push(prompt), 'never'),
    run: async () => undefined,
    reject: async () => undefined,
    deleteRun: async () => undefined,
    agentName: async (id) => (await agents.active(id)).name,
  });
  const delegation = new DelegationServer({
    runner: { run: async () => ({ text: '', costUsd: 0 }) },
    slot: async () => () => {},
  });
  await delegation.start();
  t.after(() => delegation.close());

  const calls: ModelRun[] = [];
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  let turn = 0;
  const pool = new AgentPool({ max: 1 });
  const chats = new ChatService({
    root,
    storage: storageFor(root),
    agent: (id) => agents.get({ id }),
    projects: async () => [{ name: 'demo', repo: root }],
    issues,
    delegation,
    executions: new Executions({ pool, log: () => {} }),
    runner: () => ({
      run: async (r) => {
        calls.push(r);
        turn++;
        if (turn === 1) {
          r.onEvent?.({ type: 'text', text: 'Thinking about ' });
          r.onEvent?.({ type: 'tool', name: 'Read', input: { file_path: `${root}/README.md` } });
          r.onEvent?.({ type: 'tool-result', ok: true, text: '# demo' });
          await gate;
          // The agent creates a task through its factory tool, as a model would.
          const res = await fetch(r.mcp!.url, {
            method: 'POST',
            headers: { authorization: `Bearer ${r.mcp!.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'create_task', arguments: { project: 'demo', title: 'Add a staging link' } },
            }),
          });
          await res.json();
          return { text: 'I created DEM-1.', costUsd: 0.03, sessionId: 's-1' };
        }
        return { text: 'Still here.', costUsd: 0.01, sessionId: 's-1' };
      },
    }),
  });

  const chat = await chats.start({ agent: 'mika', project: 'demo' });
  await assert.rejects(chats.start({ agent: 'mika', project: 'nope' }), Conflict);
  await chats.send({ id: chat.id, text: 'Plan the staging link work' });
  await assert.rejects(chats.send({ id: chat.id, text: 'again' }), /still replying/);
  const live = await chats.get({ id: chat.id });
  assert.equal(live.working, true);
  assert.equal(live.partial, 'Thinking about ');
  assert.deepEqual(live.partial_tools, [{ name: 'Read', detail: 'README.md', ok: true }]);
  release();
  await chats.settled(chat.id);

  const after = await chats.get({ id: chat.id });
  assert.equal(after.title, 'Plan the staging link work');
  assert.deepEqual(
    after.turns.map((x) => [x.role, x.text]),
    [
      ['user', 'Plan the staging link work'],
      ['agent', 'I created DEM-1.'],
    ],
  );
  assert.deepEqual(after.turns[1]!.tasks_created, [{ project: 'demo', key: 'DEM-1' }]);
  assert.deepEqual(after.turns[1]!.tools, [{ name: 'Read', detail: 'README.md', ok: true }]);
  assert.equal(after.partial_tools, undefined);
  assert.equal(after.session_id, 's-1');
  assert.equal(calls[0]!.tools, 'read-only');
  assert.ok(calls[0]!.guard);
  assert.deepEqual(calls[0]!.mcp?.tools, ['list_tasks', 'create_task']);
  assert.equal((await issues.get({ project: 'demo', key: 'DEM-1' })).status, 'todo');
  assert.deepEqual(submitted, [], 'a chat never starts a run');

  await chats.send({ id: chat.id, text: 'Are you there?' });
  await chats.settled(chat.id);
  assert.equal(calls[1]!.resume, 's-1');
  const listed = await chats.list({ agent: 'mika' });
  assert.deepEqual(
    listed.map((c) => [c.title, c.last, c.working]),
    [['Plan the staging link work', 'Still here.', false]],
  );
  await chats.remove({ id: chat.id });
  assert.deepEqual(await chats.list({}), []);
});

test('chat reads stay inside the repository and away from env files', () => {
  const guard = repositoryReadGuard('/repo');
  assert.equal(guard.check('Read', { file_path: '/repo/src/a.ts' }), undefined);
  assert.equal(guard.check('Grep', { pattern: 'x' }), undefined);
  assert.match(guard.check('Read', { file_path: '/Users/me/.ssh/id_rsa' }) ?? '', /only read inside/);
  assert.match(guard.check('Read', { file_path: '../secret' }) ?? '', /only read inside/);
  assert.match(guard.check('Read', { file_path: '/repo/.env.local' }) ?? '', /may not read/);
  assert.match(guard.check('Glob', { pattern: '/etc/**' }) ?? '', /inside the repository/);
});

test('a reply cut off by shutdown says so, and a stopped one says you stopped it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-chats-stop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agents = new AgentService({ root, storage: storageFor(root), seed: true });
  const executions = new Executions({ pool: new AgentPool({ max: 2 }), log: () => {} });
  let started = 0;
  const chats = new ChatService({
    root,
    storage: storageFor(root),
    agent: (id) => agents.get({ id }),
    projects: async () => [],
    issues: { create: async () => never(), update: async () => never(), list: async () => never() },
    executions,
    runner: () => ({
      run: (r) =>
        new Promise((_, fail) => {
          started++;
          r.signal?.addEventListener('abort', () => fail(new Error('model run stopped: aborted')));
        }),
    }),
  });
  const ask = async () => {
    const chat = await chats.start({ agent: 'devin' });
    await chats.send({ id: chat.id, text: 'Hello' });
    return chat.id;
  };
  const lastError = async (id: string) => (await chats.get({ id })).turns.at(-1)?.error;

  const stopped = await ask();
  assert.deepEqual(chats.stop({ id: stopped }), { stopped: true });
  await chats.settled(stopped);
  assert.equal(await lastError(stopped), 'Stopped by you.');

  const cut = await ask();
  await executions.drain(10);
  assert.equal(await lastError(cut), 'The backend stopped during this reply. Send it again.');
  assert.equal((await chats.get({ id: cut })).working, false);
  assert.equal(started, 2);
});

function never(): never {
  throw new Error('not used in this test');
}
