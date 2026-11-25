import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { storageFor } from '@factory/adapters-data';
import { AgentService } from '../src/agent-profiles.ts';
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
      tending: { enabled: false, answer_threads: false },
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
