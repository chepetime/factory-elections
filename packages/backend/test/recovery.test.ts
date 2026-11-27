// Every non-final state has a recovery rule, and the gaps the rules close stay closed: a review loop
// left at `fixing`, a ticket left at `running`, a stale `working` flag, an old unfinished run, and a
// record nobody owns that sits unwritten for an hour.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { ReviewLoopState, Ticket } from '@factory/core';
import { BackendService } from '../src/service.ts';
import { RECOVERY_STATES, RECOVERY_TABLES } from '../src/recovery.ts';

test('every state of every record type has a recovery rule', () => {
  for (const [name, table] of Object.entries(RECOVERY_TABLES)) {
    const states = RECOVERY_STATES[name as keyof typeof RECOVERY_STATES];
    assert.deepEqual(
      Object.keys(table).sort(),
      [...states].sort(),
      `${name}: the table and the schema list different states`,
    );
    for (const [state, rule] of Object.entries(table)) {
      assert.ok(rule.note.length > 0, `${name}/${state} needs a note`);
      if (rule.kind === 'reconciler') assert.ok(rule.reconciler, `${name}/${state} names its reconciler`);
    }
  }
});

async function setup(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'factory-recovery-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  const root = join(base, 'data');
  const service = new BackendService(root, { run: async () => ({ text: '', costUsd: 0 }) });
  await service.projects.add('app', repo);
  t.after(() => service.drain(10));
  const task = async (patch: Record<string, unknown> = {}) => {
    const created = await service.tasks.create('app', repo, 'Ship it', new Date().toISOString());
    const written = { ...created, ...patch };
    await service.tasks.write(written);
    return written;
  };
  const run = async (id: string, state: string, created_at: string, runId = randomUUID(), latest = true) => {
    const taskDir = dirname(service.tasks.taskPath('app', id));
    const dir = join(taskDir, 'runs', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'run.json'),
      JSON.stringify({
        id: runId,
        project: 'app',
        task_id: id,
        action: 'run',
        command: { project: 'app', id, action: 'run' },
        label: 'Running',
        state,
        created_at,
      }),
    );
    if (latest) await writeFile(join(taskDir, 'latest-run.json'), JSON.stringify({ id: runId }));
    return { runId, file: join(dir, 'run.json') };
  };
  return { root, repo, service, task, run };
}

const PR = { url: 'https://github.com/o/r/pull/4', branch: 'factory/t', head_sha: 'h1', at: 'x' };
const agentTask = {
  stage: 'pr-opened',
  workflow: 'agent',
  agent: 'devin',
  worktree: { path: '/w', branch: 'factory/t', base_branch: 'main' },
  pr: PR,
};

test('a review loop left at fixing is stopped with a reason and an inbox item after a restart', async (t) => {
  const { service, task } = await setup(t);
  const created = await task(agentTask);
  const path = join(dirname(service.tasks.taskPath('app', created.id)), 'review-loop.json');
  const loop = ReviewLoopState.parse({
    pr: 4,
    state: 'fixing',
    round: 1,
    fixes: 1,
    updated_at: new Date().toISOString(),
  });
  await service.storage.writeDocument(path, loop);
  await service.recover();
  const after = await service.reviewLoop.state(created);
  assert.equal(after?.state, 'stopped');
  assert.match(after?.reason ?? '', /backend stopped/);
  const item = (await service.inbox()).items.find((i) => i.kind === 'recovery' && i.task_id === created.id);
  assert.ok(item, 'the inbox says the loop was stopped');
  assert.match(item.title, /stopped by recovery/);
});

async function featureAt(root: string, service: BackendService, patch: Record<string, unknown>) {
  const feature = await service.features.create({ project: 'app', idea: 'Staging links everywhere' });
  const file = join(root, 'app', 'features', feature.id, 'feature.json');
  const stored = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...stored, ...patch }));
  return { id: feature.id, read: async () => JSON.parse(await readFile(file, 'utf8')) };
}
const ticket = (id: string, patch: Record<string, unknown>) =>
  Ticket.parse({
    id,
    title: `Ticket ${id}`,
    description: 'Build it',
    acceptance: ['It works'],
    size: 'S',
    state: 'running',
    ...patch,
  });

test('a ticket left at running follows its task, or starts over when the task is gone', async (t) => {
  const { root, service, task } = await setup(t);
  const failedTask = await task({ stage: 'failed' });
  const gateTask = await task({ stage: 'awaiting-approval' });
  const codingTask = await task({ stage: 'coding' });
  const feature = await featureAt(root, service, {
    stage: 'implementing',
    tickets: [
      ticket('T1', { task_id: failedTask.id }),
      ticket('T2', { task_id: gateTask.id }),
      ticket('T3', { task_id: randomUUID() }),
      ticket('T4', {}),
      ticket('T5', { task_id: codingTask.id }),
    ],
  });
  await service.recover();
  const byId = new Map((await feature.read()).tickets.map((x: Ticket) => [x.id, x]));
  assert.equal(byId.get('T1')?.state, 'failed');
  assert.equal(byId.get('T2')?.state, 'done');
  // The task is gone: the loop makes a new one.
  assert.equal(byId.get('T3')?.state, 'waiting');
  assert.equal(byId.get('T3')?.task_id, undefined);
  assert.equal(byId.get('T4')?.state, 'waiting');
  // Its task is still at a working stage with no run to settle: the ticket keeps following it.
  assert.equal(byId.get('T5')?.state, 'running', 'a task that is still active keeps its ticket running');
});

test('a stale working flag is cleared in storage, not only hidden on read', async (t) => {
  const { root, service } = await setup(t);
  const feature = await featureAt(root, service, {
    working: { action: 'write-spec', started_at: new Date().toISOString() },
  });
  assert.ok((await feature.read()).working, 'the flag is stored');
  await service.recover();
  const after = await feature.read();
  assert.equal(after.working, undefined);
  assert.match(after.error, /backend stopped/);
});

test('an unfinished run that is not the latest is interrupted and the task stage stays', async (t) => {
  const { service, task, run } = await setup(t);
  const created = await task({ stage: 'awaiting-approval' });
  const old = await run(created.id, 'running', '2026-11-01T00:00:00.000Z', randomUUID(), false);
  const older = await run(created.id, 'queued', '2026-11-01T00:00:01.000Z', randomUUID(), false);
  await run(created.id, 'completed', '2026-11-02T00:00:00.000Z');
  const counts = await service.recover();
  assert.equal(counts.interrupted, 2);
  const settled = JSON.parse(await readFile(old.file, 'utf8'));
  assert.equal(settled.state, 'interrupted');
  assert.equal(settled.cleanup.status, 'uncertain');
  assert.equal(JSON.parse(await readFile(older.file, 'utf8')).state, 'interrupted');
  assert.equal((await service.tasks.read('app', created.id)).stage, 'awaiting-approval');
});

test('a record nobody owns shows in the inbox once it sits unwritten for an hour, not before', async (t) => {
  const { service, task, run } = await setup(t);
  const old = await task();
  const fresh = await task();
  const now = Date.now();
  await run(old.id, 'running', new Date(now - 90 * 60_000).toISOString());
  await run(fresh.id, 'running', new Date(now - 10 * 60_000).toISOString());
  const found = await service.detectStuck(now);
  assert.deepEqual(
    found.map((r) => [r.kind, r.id]),
    [['run', old.id]],
  );
  const inbox = await service.inbox();
  const items = inbox.items.filter((i) => i.kind === 'recovery');
  assert.deepEqual(
    items.map((i) => i.task_id),
    [old.id],
  );
  assert.match(items[0]!.id, /^stuck:run:app:/);
  // Later the younger one is old enough too; its id is stable across checks.
  await service.detectStuck(now + 60 * 60_000);
  const later = (await service.inbox()).items.filter((i) => i.kind === 'recovery');
  assert.equal(later.length, 2);
  assert.ok(later.some((i) => i.id === items[0]!.id));
});
