import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { storageFor } from '@factory/adapters-data';
import { TaskRecord } from '@factory/core';
import { AgentPickup, PICKUP_RETRY_MS, AgentService } from '@factory/agents';
import { Conflict } from '../src/conflict.ts';
import { IssueService } from '../src/issues.ts';

test('a free agent starts its Todo tasks, waits while busy, and notes a failed start once', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-pickup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agents = new AgentService({ root, storage: storageFor(root), seed: true });
  const tasks: TaskRecord[] = [];
  let refuse: string | undefined;
  let blocked: string | undefined;
  const running = new Set<string>();
  const finish = (i: number) => {
    running.delete(tasks[i]!.id);
    tasks[i] = { ...tasks[i]!, stage: 'awaiting-approval' };
  };
  const issues = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => tasks },
    settings: async () => ({
      task_manager: { kind: 'none' },
      tending: { enabled: false, answer_threads: false },
    }),
    submit: async ({ prompt, agent }) => {
      if (refuse) throw new Conflict(refuse);
      const run = TaskRecord.parse({
        id: randomUUID(),
        project: 'demo',
        repo: '/r',
        prompt,
        stage: 'queued',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(agent ? { workflow: 'agent', agent } : {}),
      });
      tasks.push(run);
      return run.id;
    },
    // The backend schedules the run; a test run stays scheduled until the test ends it.
    run: async (_p, id) => void running.add(id),
    reject: async () => undefined,
    deleteRun: async () => undefined,
    agentName: async (id) => (await agents.active(id)).name,
  });
  let now = Date.parse('2026-11-25T12:00:00.000Z');
  const pickup = new AgentPickup({
    agents: () => agents.list(),
    projects: async () => [{ name: 'demo' }],
    issues,
    tasks: async () => tasks,
    scheduled: (_p, id) => running.has(id),
    blocker: async () => blocked,
    accepting: () => true,
    now: () => now,
  });

  await issues.create({ project: 'demo', title: 'First', status: 'todo' });
  await issues.create({ project: 'demo', title: 'Second', status: 'todo' });
  await issues.create({ project: 'demo', title: 'Later', status: 'backlog' });
  for (const key of ['DEM-1', 'DEM-2', 'DEM-3'])
    await issues.update({ project: 'demo', key, assignee: 'devin' });

  assert.deepEqual(await pickup.tick(), ['DEM-1'], 'one slot: the oldest Todo task');
  assert.deepEqual(await pickup.tick(), [], 'Devin is busy');
  finish(0);
  assert.deepEqual(await pickup.tick(), ['DEM-2'], 'a run waiting for you frees the agent');

  finish(1);
  await issues.create({ project: 'demo', title: 'Blocked by setup', status: 'todo' });
  await issues.update({ project: 'demo', key: 'DEM-4', assignee: 'devin' });
  refuse = 'Approve the repo profile first.';
  assert.deepEqual(await pickup.tick(), []);
  assert.deepEqual(await pickup.tick(), [], 'no retry before the wait ends');
  const noted = await issues.get({ project: 'demo', key: 'DEM-4' });
  assert.equal(
    noted.events.filter((e) => e.kind === 'pickup-failed').length,
    1,
    'one note, not one per pass',
  );
  assert.match(noted.events.at(-1)!.message, /Devin could not start: Approve the repo profile first/);

  refuse = undefined;
  now += PICKUP_RETRY_MS + 1;
  assert.deepEqual(await pickup.tick(), ['DEM-4']);
  finish(2);

  // A known blocker is checked first: the task gets only the note, never a "started" event.
  await issues.create({ project: 'demo', title: 'Blocked first', status: 'todo' });
  await issues.update({ project: 'demo', key: 'DEM-5', assignee: 'devin' });
  blocked = 'The repo profile is not approved.';
  const eventsBefore = (await issues.get({ project: 'demo', key: 'DEM-5' })).events.length;
  assert.deepEqual(await pickup.tick(), []);
  const after = await issues.get({ project: 'demo', key: 'DEM-5' });
  assert.equal(after.events.length, eventsBefore + 1);
  assert.deepEqual(after.runs, []);
  blocked = undefined;
  now += PICKUP_RETRY_MS + 1;
  assert.deepEqual(await pickup.tick(), ['DEM-5']);
  finish(3);

  await agents.update({ id: 'devin', auto_pickup: false });
  await issues.create({ project: 'demo', title: 'Manual only', status: 'todo' });
  await issues.update({ project: 'demo', key: 'DEM-6', assignee: 'devin' });
  assert.deepEqual(await pickup.tick(), [], 'pickup is off for this agent');

  // A run left queued and unscheduled (a refused start, a backend restart) starts again.
  await agents.update({ id: 'devin', auto_pickup: true });
  assert.deepEqual(await pickup.tick(), ['DEM-6']);
  running.clear();
  assert.equal(tasks.at(-1)!.stage, 'queued');
  const before = tasks.length;
  now += PICKUP_RETRY_MS + 1;
  assert.deepEqual(await pickup.tick(), ['DEM-6'], 'the queued run is started, not replaced');
  assert.equal(tasks.length, before);
});

test('the coordinator assigns unassigned Todo tasks, once, and the chosen agent starts them', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-route-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agents = new AgentService({ root, storage: storageFor(root), seed: true });
  const tasks: TaskRecord[] = [];
  const issues = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => tasks },
    settings: async () => ({
      task_manager: { kind: 'none' },
      tending: { enabled: false, answer_threads: false },
    }),
    submit: async ({ prompt, agent }) => {
      const run = TaskRecord.parse({
        id: randomUUID(),
        project: 'demo',
        repo: '/r',
        prompt,
        stage: 'queued',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(agent ? { workflow: 'agent', agent } : {}),
      });
      tasks.push(run);
      return run.id;
    },
    run: async () => undefined,
    reject: async () => undefined,
    deleteRun: async () => undefined,
    agentName: async (id) => (await agents.active(id)).name,
  });
  const asked: string[] = [];
  const pickup = new AgentPickup({
    agents: () => agents.list(),
    projects: async () => [{ name: 'demo' }],
    issues,
    tasks: async () => tasks,
    scheduled: () => false,
    accepting: () => true,
    route: async (task) => {
      asked.push(task.key);
      return task.title.includes('logo')
        ? { by: 'Mika', agent: 'magda', reason: 'Visual design work.' }
        : { by: 'Mika', reason: 'Nothing here is work for an agent.' };
    },
  });
  await issues.create({ project: 'demo', title: 'Redraw the logo', status: 'todo' });
  await issues.create({ project: 'demo', title: 'Buy coffee', status: 'todo' });
  await issues.create({ project: 'demo', title: 'Someday', status: 'backlog' });

  assert.deepEqual(await pickup.tick(), ['DEM-1'], 'Magda starts the task she was given');
  const logo = await issues.get({ project: 'demo', key: 'DEM-1' });
  assert.equal(logo.assignee, 'magda');
  assert.ok(logo.events.some((e) => e.message === 'Mika chose Magda: Visual design work.'));
  const coffee = await issues.get({ project: 'demo', key: 'DEM-2' });
  assert.equal(coffee.assignee, undefined);
  assert.match(coffee.events.at(-1)!.message, /Mika found no agent for this task/);

  await pickup.tick();
  assert.deepEqual(asked, ['DEM-1', 'DEM-2'], 'no second paid call for an unchanged task, none for Backlog');
  await issues.update({ project: 'demo', key: 'DEM-2', description: 'Order beans for the office' });
  await pickup.tick();
  assert.deepEqual(asked, ['DEM-1', 'DEM-2', 'DEM-2'], 'an edit asks again');
});
