import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { storageFor } from '@factory/adapters-data';
import { TaskRecord, type ProjectSettings, type Stage } from '@factory/core';
import { Conflict } from '../src/conflict.ts';
import { IssueService, issuePrompt } from '../src/issues.ts';

function run(prompt: string, created_at: string, stage: Stage = 'queued', extra: Partial<TaskRecord> = {}) {
  return TaskRecord.parse({
    id: randomUUID(),
    project: 'change-elections',
    repo: '/repo',
    prompt,
    stage,
    created_at,
    updated_at: created_at,
    ...extra,
  });
}

async function setup(t: TestContext, tasks: TaskRecord[] = [], settings: Partial<ProjectSettings> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'factory-issues-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls: string[] = [];
  let clock = Date.parse('2026-11-25T12:00:00.000Z');
  const service = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => tasks },
    settings: async () => ({
      task_manager: { kind: 'none' },
      tending: { enabled: false, answer_threads: false },
      ...settings,
    }),
    submit: async ({ prompt, jiraKey }) => {
      const created = run(
        prompt,
        new Date(clock).toISOString(),
        'queued',
        jiraKey ? { jira_key: jiraKey } : {},
      );
      tasks.push(created);
      calls.push(`submit:${prompt}`);
      return created.id;
    },
    run: async (_project, id) => {
      calls.push(`run:${id}`);
      const task = tasks.find((x) => x.id === id)!;
      tasks[tasks.indexOf(task)] = {
        ...task,
        stage: 'coding',
        updated_at: new Date((clock += 1000)).toISOString(),
      };
    },
    reject: async (_project, id, note) => {
      calls.push(`reject:${id}:${note}`);
      const task = tasks.find((x) => x.id === id)!;
      tasks[tasks.indexOf(task)] = {
        ...task,
        stage: 'rejected',
        updated_at: new Date((clock += 1000)).toISOString(),
      };
    },
    now: () => new Date((clock += 1000)),
  });
  return { root, service, calls, tasks };
}

test('existing runs are numbered in creation order once, then new tasks take the next number', async (t) => {
  const later = run('Second run\nmore', '2026-11-20T10:00:00.000Z', 'awaiting-approval', {
    name: 'Named run',
  });
  const earlier = run('First run\n\ndetails', '2026-11-18T10:00:00.000Z', 'failed', { jira_key: 'VOTE-1' });
  const { root, service } = await setup(t, [later, earlier]);

  const first = await service.list('change-elections');
  assert.equal(first.prefix, 'CE');
  assert.deepEqual(
    first.items.map((i) => [i.key, i.title, i.status, i.runs[0]]),
    [
      ['CE-1', 'First run', 'blocked', earlier.id],
      ['CE-2', 'Named run', 'in_review', later.id],
    ],
  );
  assert.equal(first.items[0]!.jira_key, 'VOTE-1');
  assert.equal(first.items[0]!.description, 'First run\n\ndetails');

  const again = await service.list('change-elections');
  assert.deepEqual(
    again.items.map((i) => i.key),
    ['CE-1', 'CE-2'],
  );
  const created = await service.create({ project: 'change-elections', title: 'Plan the launch' });
  assert.equal(created.key, 'CE-3');
  assert.equal(created.status, 'backlog');
  const stored = JSON.parse(await readFile(join(root, 'change-elections', 'issues.json'), 'utf8'));
  assert.equal(stored.next, 4);
});

test('the prefix comes from settings, and any prefix or a run id finds the task', async (t) => {
  const wrapped = run('Wrapped', '2026-11-18T10:00:00.000Z');
  const { service } = await setup(t, [wrapped], { prefix: 'VOTE' });
  const list = await service.list('change-elections');
  assert.equal(list.items[0]!.key, 'VOTE-1');
  assert.equal((await service.get({ project: 'change-elections', key: 'CE-1' })).key, 'VOTE-1');
  assert.equal((await service.get({ project: 'change-elections', key: wrapped.id })).key, 'VOTE-1');
  await assert.rejects(service.get({ project: 'change-elections', key: 'VOTE-9' }), /Task not found/);
});

test('concurrent creates get distinct numbers', async (t) => {
  const { service } = await setup(t);
  const made = await Promise.all(
    Array.from({ length: 8 }, (_, n) => service.create({ project: 'change-elections', title: `Task ${n}` })),
  );
  assert.deepEqual(
    made.map((i) => i.number).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test('updates record what changed, and comments append', async (t) => {
  const { service } = await setup(t);
  await service.create({ project: 'change-elections', title: 'Draft', description: 'old' });
  const same = await service.update({ project: 'change-elections', key: 'CE-1', title: 'Draft' });
  assert.deepEqual(
    same.events.map((e) => e.kind),
    ['created'],
  );
  const edited = await service.update({
    project: 'change-elections',
    key: 'CE-1',
    title: 'Final',
    description: 'new',
    priority: 'high',
  });
  assert.deepEqual([edited.title, edited.description, edited.priority], ['Final', 'new', 'high']);
  assert.deepEqual(
    edited.events.map((e) => e.kind),
    ['created', 'edit:title', 'edit:description', 'edit:priority'],
  );
  const commented = await service.comment({ project: 'change-elections', key: 'CE-1', body: 'Looks right' });
  assert.equal(commented.comments.at(-1)?.body, 'Looks right');
  await assert.rejects(service.comment({ project: 'change-elections', key: 'CE-1', body: '  ' }));
});

test('moving without a run only sets the status', async (t) => {
  const { service, calls } = await setup(t);
  await service.create({ project: 'change-elections', title: 'Idea' });
  const moved = await service.move({ project: 'change-elections', key: 'CE-1', to: 'todo' });
  assert.equal(moved.action, 'set-status');
  assert.equal(moved.issue.status, 'todo');
  assert.deepEqual(calls, []);
  await assert.rejects(service.move({ project: 'change-elections', key: 'CE-1', to: 'in_review' }), Conflict);
});

test('In progress starts a run from the title and description, then follows the run', async (t) => {
  const { service, calls, tasks } = await setup(t);
  await service.create({
    project: 'change-elections',
    title: 'Add a staging link',
    description: 'In the README.',
    jira_key: 'VOTE-7',
  });
  const moved = await service.move({ project: 'change-elections', key: 'CE-1', to: 'in_progress' });
  assert.equal(moved.action, 'start-run');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.jira_key, 'VOTE-7');
  assert.deepEqual(calls, [
    `submit:${issuePrompt({ title: 'Add a staging link', description: 'In the README.' })}`,
    `run:${tasks[0]!.id}`,
  ]);
  assert.deepEqual(moved.issue.runs, [tasks[0]!.id]);
  assert.equal(moved.issue.status, 'in_progress');
  assert.equal((await service.list('change-elections')).items.length, 1, 'the new run is not wrapped twice');
});

test('a failed run runs again, and Cancelled rejects an open run', async (t) => {
  const failed = run('Broken', '2026-11-18T10:00:00.000Z', 'failed');
  const { service, calls } = await setup(t, [failed]);
  const again = await service.move({ project: 'change-elections', key: 'CE-1', to: 'in_progress' });
  assert.equal(again.action, 'run');
  assert.deepEqual(calls, [`run:${failed.id}`]);
  const cancelled = await service.move({ project: 'change-elections', key: 'CE-1', to: 'cancelled' });
  assert.equal(cancelled.action, 'reject');
  assert.equal(calls.at(-1), `reject:${failed.id}:Cancelled from the task board.`);
  assert.equal(cancelled.issue.status, 'cancelled');
});

test('drops that would skip the approval gate or override an open run are refused', async (t) => {
  const waiting = run('Waiting', '2026-11-18T10:00:00.000Z', 'awaiting-approval');
  const { service, calls } = await setup(t, [waiting]);
  await assert.rejects(service.move({ project: 'change-elections', key: 'CE-1', to: 'done' }), /task page/);
  await assert.rejects(
    service.move({ project: 'change-elections', key: 'CE-1', to: 'in_progress' }),
    /task page/,
  );
  assert.deepEqual(calls, []);
});
