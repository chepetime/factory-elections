// The ownership fence on run.json (ADR 0005): an old backend's finalize cannot overwrite a newer owner.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { storageFor } from '@factory/adapters-data';
import type { TaskRecord } from '@factory/core';
import { RunExecutor } from '../src/run-executor.ts';
import { nextGeneration } from '../src/server.ts';
import type { RunRecord } from '../src/run-record.ts';

const ID = '11111111-1111-4111-8111-111111111111';
async function fixture(t: TestContext, generation: number, onCheck: (runJson: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'factory-fence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'demo', 'tasks', ID, 'runs', ID);
  await mkdir(dir, { recursive: true });
  const record: RunRecord = {
    id: ID,
    project: 'demo',
    task_id: ID,
    action: 'check',
    command: { project: 'demo', id: ID, action: 'check' } as RunRecord['command'],
    label: 'Check',
    state: 'queued',
    created_at: new Date().toISOString(),
  };
  const storage = storageFor(root);
  await storage.writeDocument(join(dir, 'run.json'), { ...record, owner_generation: 1 });
  const task = { id: ID, project: 'demo', stage: 'queued', events: [] } as unknown as TaskRecord;
  const written: TaskRecord[] = [];
  const executor = new RunExecutor({
    storage,
    tasks: {
      read: async () => task,
      write: async (next) => void written.push(next),
      taskPath: () => join(root, 'demo', 'tasks', ID, 'task.json'),
    },
    traces: {} as never,
    taskTraces: { start: async () => undefined, end: async () => undefined } as never,
    memory: { recording: (_p: string, _r: string, runner: unknown) => runner } as never,
    user: { get: async () => ({}) as never },
    runner: () => ({ run: async () => ({}) as never }),
    driver: () =>
      ({
        deps: { shell: { runShell: async () => ({}) } },
        check: async () => {
          await onCheck(join(dir, 'run.json'));
          return { stage: 'awaiting-approval' };
        },
      }) as never,
    stopRequested: () => false,
    receipt: async () => undefined,
    kick: () => undefined,
    generation,
  });
  const run = () => executor.run(record.command, { ...record, owner_generation: 1 }, dir, () => undefined);
  const stored = async () => JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')) as RunRecord;
  const events = async () =>
    (await readFile(join(dir, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(
        (line) => JSON.parse(line) as { kind: string; stored_generation?: number; own_generation?: number },
      );
  return { run, stored, events, storage, written };
}

test('the current owner finalizes its run and stamps its generation', async (t) => {
  const { run, stored, events } = await fixture(t, 1, async () => undefined);
  await run();
  const record = await stored();
  assert.equal(record.state, 'completed');
  assert.equal(record.owner_generation, 1);
  assert.equal(
    (await events()).some((event) => event.kind === 'finalize.fenced'),
    false,
  );
});

test('an old owner that finalizes after recovery leaves the interrupted record and logs finalize.fenced', async (t) => {
  let interrupted: RunRecord | undefined;
  const { run, stored, events } = await fixture(t, 1, async (runJson) => {
    // Another backend (generation 2) recovers the run while this one hangs.
    const current = JSON.parse(await readFile(runJson, 'utf8')) as RunRecord;
    interrupted = { ...current, state: 'interrupted', outcome: 'interrupted', owner_generation: 2 };
    await writeFile(runJson, JSON.stringify(interrupted));
  });
  await run();
  assert.deepEqual(await stored(), interrupted);
  const fenced = (await events()).filter((event) => event.kind === 'finalize.fenced');
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0]!.stored_generation, 2);
  assert.equal(fenced[0]!.own_generation, 1);
});

test('each start increases the backend generation, and a garbled file counts as 0', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-generation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await nextGeneration(root), 1);
  assert.equal(await nextGeneration(root), 2);
  assert.equal((await readFile(join(root, 'backend-generation'), 'utf8')).trim(), '2');
  await writeFile(join(root, 'backend-generation'), 'nonsense');
  assert.equal(await nextGeneration(root), 1);
});
