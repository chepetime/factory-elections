import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { storageFor } from '@factory/adapters-data';
import { TaskRecord } from '@factory/core';
import {
  AgentPickup,
  PICKUP_RETRY_MS,
  AgentService,
  documentPickupState,
  type PickupStateStore,
} from '@factory/agents';
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
      tending: { enabled: false, answer_threads: false, trusted_logins: [] },
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
      tending: { enabled: false, answer_threads: false, trusted_logins: [] },
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

/** A board in a temp root, with a pickup factory so a test can "restart" by building a second one. */
async function restartable(t: { after: (fn: () => Promise<void>) => void }, prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agents = new AgentService({ root, storage: storageFor(root), seed: true });
  const tasks: TaskRecord[] = [];
  const control = { refuse: undefined as string | undefined, now: Date.parse('2026-11-26T10:00:00.000Z') };
  const asked: string[] = [];
  const logs: string[] = [];
  const issues = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => tasks },
    settings: async () => ({
      task_manager: { kind: 'none' },
      tending: { enabled: false, answer_threads: false, trusted_logins: [] },
    }),
    submit: async ({ prompt, agent }) => {
      if (control.refuse) throw new Conflict(control.refuse);
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
  const pickup = (state: PickupStateStore) =>
    new AgentPickup({
      agents: () => agents.list(),
      projects: async () => [{ name: 'demo' }],
      issues,
      tasks: async () => tasks,
      scheduled: () => false,
      accepting: () => true,
      route: async (task) => {
        asked.push(task.key);
        return { by: 'Mika', reason: 'Nothing here is work for an agent.' };
      },
      state,
      now: () => control.now,
      log: (line) => logs.push(line),
    });
  return { root, issues, pickup, control, asked, logs };
}

test('a failed start still waits after a restart', async (t) => {
  const { root, issues, pickup, control } = await restartable(t, 'factory-pickup-restart-');
  const state = documentPickupState(root, storageFor(root));
  await issues.create({ project: 'demo', title: 'Needs setup', status: 'todo' });
  await issues.update({ project: 'demo', key: 'DEM-1', assignee: 'devin' });
  control.refuse = 'Approve the repo profile first.';
  assert.deepEqual(await pickup(state).tick(), []);

  // A new instance with the same store, as after a restart: still waiting, no second note.
  control.now += 2 * 60_000;
  await issues.note({ project: 'demo', key: 'DEM-1', kind: 'comment', message: 'An event in between.' });
  const restarted = pickup(documentPickupState(root, storageFor(root)));
  assert.deepEqual(await restarted.tick(), []);
  const task = await issues.get({ project: 'demo', key: 'DEM-1' });
  assert.equal(task.events.filter((e) => e.kind === 'pickup-failed').length, 1);

  control.refuse = undefined;
  control.now += PICKUP_RETRY_MS;
  assert.deepEqual(await restarted.tick(), ['DEM-1']);
});

test('a task the coordinator could not route is not routed again after a restart until it is edited', async (t) => {
  const { root, issues, pickup, asked } = await restartable(t, 'factory-pickup-unrouted-');
  await issues.create({ project: 'demo', title: 'Buy coffee', status: 'todo' });
  await pickup(documentPickupState(root, storageFor(root))).tick();
  assert.deepEqual(asked, ['DEM-1']);

  const restarted = pickup(documentPickupState(root, storageFor(root)));
  await restarted.tick();
  assert.deepEqual(asked, ['DEM-1'], 'no second paid call after a restart');
  await new Promise((resolve) => setTimeout(resolve, 5)); // the edit must get a later updated_at
  await issues.update({ project: 'demo', key: 'DEM-1', description: 'Order beans' });
  await restarted.tick();
  assert.deepEqual(asked, ['DEM-1', 'DEM-1'], 'an edit asks again');
});

test('an unreadable pickup state file starts empty and pickup continues', async (t) => {
  const { root, issues, pickup, logs, control } = await restartable(t, 'factory-pickup-corrupt-');
  await mkdir(join(root, '.workspace'), { recursive: true });
  await writeFile(join(root, '.workspace', 'pickup.json'), '{ not json');
  await issues.create({ project: 'demo', title: 'First', status: 'todo' });
  await issues.update({ project: 'demo', key: 'DEM-1', assignee: 'devin' });
  assert.deepEqual(await pickup(documentPickupState(root, storageFor(root))).tick(), ['DEM-1']);
  assert.equal(logs.filter((l) => /empty state/.test(l)).length, 1, 'one line in the log');

  // A failed save only logs: pickup goes on. The entry for a task that is gone is pruned, which saves.
  const stale = {
    retry: { 'demo/GONE-9': { at: new Date(control.now).toISOString(), failures: 1 } },
    unrouted: {},
  };
  const failing = pickup({ load: async () => stale, save: () => Promise.reject(new Error('disk full')) });
  assert.deepEqual(await failing.tick(), ['DEM-1'], 'the queued run starts again');
  assert.ok(logs.some((l) => /cannot save state: disk full/.test(l)));
});

test('starting a task removes its retry entry', async (t) => {
  const { root, issues, pickup, control } = await restartable(t, 'factory-pickup-clear-');
  const state = documentPickupState(root, storageFor(root));
  await issues.create({ project: 'demo', title: 'Needs setup', status: 'todo' });
  await issues.update({ project: 'demo', key: 'DEM-1', assignee: 'devin' });
  control.refuse = 'Approve the repo profile first.';
  const instance = pickup(state);
  await instance.tick();
  assert.deepEqual(Object.keys((await state.load())!.retry), ['demo/DEM-1']);

  control.refuse = undefined;
  control.now += PICKUP_RETRY_MS;
  assert.deepEqual(await instance.tick(), ['DEM-1']);
  assert.deepEqual((await state.load())!.retry, {});
});

test('pickup does not start a ticket whose blocker is not Done (FE-22 waits for FE-21)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-pickup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agents = new AgentService({ root, storage: storageFor(root), seed: true });
  const tasks: TaskRecord[] = [];
  const running = new Set<string>();
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
        ...(agent ? { workflow: 'agent', agent } : {}),
      });
      tasks.push(run);
      return run.id;
    },
    run: async (_p, id) => void running.add(id),
    reject: async () => undefined,
    deleteRun: async () => undefined,
    agentName: async (id) => (await agents.active(id)).name,
  });
  const pickup = new AgentPickup({
    agents: () => agents.list(),
    projects: async () => [{ name: 'demo' }],
    issues,
    tasks: async () => tasks,
    scheduled: (_p, id) => running.has(id),
    accepting: () => true,
  });
  await issues.create({ project: 'demo', title: 'FE-21 code', status: 'backlog' });
  await issues.create({ project: 'demo', title: 'FE-22 needs it', status: 'todo', priority: 'urgent' });
  await issues.update({ project: 'demo', key: 'DEM-2', assignee: 'devin', blocked_by: ['DEM-1'] });
  assert.deepEqual(await pickup.tick(), [], 'the blocker is not Done');
  assert.deepEqual((await issues.get({ project: 'demo', key: 'DEM-2' })).runs, []);
  await issues.move({ project: 'demo', key: 'DEM-1', to: 'done' });
  assert.deepEqual(await pickup.tick(), ['DEM-2']);
});
