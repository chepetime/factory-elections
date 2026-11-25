import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { storageFor } from '@factory/adapters-data';
import { TaskRecord } from '@factory/core';
import { AgentPickup, PICKUP_RETRY_MS } from '../src/agent-pickup.ts';
import { AgentService } from '../src/agent-profiles.ts';
import { Conflict } from '../src/conflict.ts';
import { IssueService } from '../src/issues.ts';

test('a free agent starts its Todo tasks, waits while busy, and notes a failed start once', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-pickup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agents = new AgentService({ root, storage: storageFor(root), seed: true });
  const tasks: TaskRecord[] = [];
  let refuse: string | undefined;
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

  await agents.update({ id: 'devin', auto_pickup: false });
  await issues.create({ project: 'demo', title: 'Manual only', status: 'todo' });
  await issues.update({ project: 'demo', key: 'DEM-5', assignee: 'devin' });
  finish(2);
  assert.deepEqual(await pickup.tick(), [], 'pickup is off for this agent');

  // A run left queued and unscheduled (a refused start, a backend restart) starts again.
  await agents.update({ id: 'devin', auto_pickup: true });
  assert.deepEqual(await pickup.tick(), ['DEM-5']);
  running.clear();
  assert.equal(tasks.at(-1)!.stage, 'queued');
  const before = tasks.length;
  now += PICKUP_RETRY_MS + 1;
  assert.deepEqual(await pickup.tick(), ['DEM-5'], 'the queued run is started, not replaced');
  assert.equal(tasks.length, before);
});
