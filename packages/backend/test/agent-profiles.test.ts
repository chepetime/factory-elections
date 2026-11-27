import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { storageFor } from '@factory/adapters-data';
import { TaskRecord } from '@factory/core';
import { AgentService } from '@factory/agents';
import { Conflict } from '../src/conflict.ts';
import { IssueService } from '../src/issues.ts';

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'factory-agents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agents = new AgentService({ root, storage: storageFor(root) });
  const issues = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => [] },
    settings: async () => ({
      task_manager: { kind: 'none' },
      tending: { enabled: false, answer_threads: false, trusted_logins: [] },
    }),
    submit: async () => {
      throw new Error('no runs in this test');
    },
    run: async () => undefined,
    reject: async () => undefined,
    deleteRun: async () => undefined,
    agentName: async (id) => (await agents.active(id)).name,
  });
  return { root, agents, issues };
}

test('agents get unique ids, keep edits, and archive', async (t) => {
  const { agents } = await setup(t);
  const mika = await agents.create({ name: 'Mika', description: 'Chief of staff' });
  const twin = await agents.create({ name: 'Mika' });
  assert.deepEqual([mika.id, twin.id], ['mika', 'mika-2']);
  await assert.rejects(agents.create({ name: '  ' }));

  const edited = await agents.update({
    id: 'mika',
    instructions: 'We do not deploy on Fridays.',
    concurrency: 2,
  });
  assert.equal(edited.instructions, 'We do not deploy on Fridays.');
  assert.equal(edited.name, 'Mika');
  await assert.rejects(agents.update({ id: 'mika', concurrency: 9 }));
  await assert.rejects(agents.update({ id: 'ghost', name: 'x' }), Conflict);

  const archived = await agents.archive({ id: 'mika', archived: true });
  assert.ok(archived.archived_at);
  await assert.rejects(agents.active('mika'), /archived/);
  assert.equal((await agents.archive({ id: 'mika', archived: false })).archived_at, undefined);
  assert.equal((await agents.list()).length, 2);
});

test('a task takes an active agent as its assignee, and can drop it', async (t) => {
  const { agents, issues } = await setup(t);
  await agents.create({ name: 'Mika' });
  await issues.create({ project: 'demo', title: 'Write the README' });

  const assigned = await issues.update({ project: 'demo', key: 'DEM-1', assignee: 'mika' });
  assert.equal(assigned.assignee, 'mika');
  assert.equal(assigned.events.at(-1)?.message, 'Assigned to Mika');

  await assert.rejects(issues.update({ project: 'demo', key: 'DEM-1', assignee: 'ghost' }), /not found/);
  await agents.archive({ id: 'mika', archived: true });
  await assert.rejects(issues.update({ project: 'demo', key: 'DEM-1', assignee: 'mika' }), /archived/);

  const cleared = await issues.update({ project: 'demo', key: 'DEM-1', assignee: null });
  assert.equal(cleared.assignee, undefined);
  assert.equal(cleared.events.at(-1)?.message, 'Removed the agent');
});

test('a new workspace starts with Devin and Mika, stored once', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-agents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agents = new AgentService({ root, storage: storageFor(root), seed: true });
  const first = await agents.list();
  assert.deepEqual(
    first.map((a) => [a.id, a.avatar]),
    [
      ['devin', '🐸'],
      ['mika', '🦄'],
      ['acosta', '🧭'],
      ['magda', '🎨'],
      ['sherlock', '🔍'],
      ['lumix', '📋'],
    ],
  );
  assert.deepEqual(first.find((a) => a.id === 'sherlock')?.skills, ['senior-pr-review']);
  await agents.archive({ id: 'mika', archived: true });
  const again = await new AgentService({ root, storage: storageFor(root), seed: true }).list();
  assert.equal(again.find((a) => a.id === 'mika')?.archived_at !== undefined, true);
  assert.equal(again[0]!.created_at, first[0]!.created_at);
});

test('a task with an agent starts that agent, and a reply wakes it only while it waits', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-agents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agents = new AgentService({ root, storage: storageFor(root), seed: true });
  const tasks: TaskRecord[] = [];
  const calls: string[] = [];
  const issues = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => tasks },
    settings: async () => ({
      task_manager: { kind: 'none' },
      tending: { enabled: false, answer_threads: false, trusted_logins: [] },
    }),
    submit: async ({ prompt, agent }) => {
      const run = TaskRecord.parse({
        id: randomUUID(),
        project: 'demo',
        repo: '/r',
        prompt,
        stage: 'queued',
        created_at: '2026-11-25T12:00:00.000Z',
        updated_at: '2026-11-25T12:00:00.000Z',
        ...(agent ? { workflow: 'agent', agent } : {}),
      });
      tasks.push(run);
      calls.push(`submit:${agent ?? 'pipeline'}`);
      return run.id;
    },
    run: async (_p, id) => calls.push(`run:${tasks.findIndex((x) => x.id === id)}`),
    revise: async (_p, _id, note) => calls.push(`revise:${note}`),
    reject: async () => undefined,
    deleteRun: async () => undefined,
    agentName: async (id) => (await agents.active(id)).name,
  });
  await issues.create({ project: 'demo', title: 'Add a staging link', status: 'todo' });
  await issues.update({ project: 'demo', key: 'DEM-1', assignee: 'devin' });
  await issues.move({ project: 'demo', key: 'DEM-1', to: 'in_progress' });
  assert.deepEqual(calls, ['submit:devin', 'run:0']);

  const stage = (s: TaskRecord['stage']) =>
    (tasks[0] = { ...tasks[0]!, stage: s, updated_at: new Date().toISOString() });
  stage('coding');
  await issues.comment({ project: 'demo', key: 'DEM-1', body: 'Use the README intro.' });
  stage('awaiting-approval');
  await issues.comment({ project: 'demo', key: 'DEM-1', body: 'Also link production.' });
  stage('blocked');
  await issues.comment({ project: 'demo', key: 'DEM-1', body: 'Name it Staging.' });
  stage('approved');
  await issues.comment({ project: 'demo', key: 'DEM-1', body: 'Thanks!' });
  await issues.comment({ project: 'demo', key: 'DEM-1', body: 'From the agent', author: 'devin' });
  assert.deepEqual(calls, ['submit:devin', 'run:0', 'revise:Also link production.', 'run:0']);
});
