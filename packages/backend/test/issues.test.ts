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

async function setup(
  t: TestContext,
  tasks: TaskRecord[] = [],
  settings: Partial<ProjectSettings> = {},
  failingDelete?: string,
  waiting: Set<string> = new Set(),
) {
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
      tending: { enabled: false, answer_threads: false, trusted_logins: [] },
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
    run: async (_project, id, reply) => {
      calls.push(`run:${id}`);
      if (reply) calls.push(`reply:${id}:${reply}`);
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
    cancelQueued: async (_project, id) => {
      calls.push(`cancelQueued:${id}`);
      waiting.delete(id);
    },
    deleteRun: async (_project, id) => {
      calls.push(`delete:${id}`);
      if (id === failingDelete) throw new Error('git refused');
      tasks.splice(
        tasks.findIndex((x) => x.id === id),
        1,
      );
    },
    followUp: async (_project, id, input) =>
      void calls.push(`followUp:${id}:${input.kind}:${input.agent}:${input.by}:${input.prHead ?? ''}`),
    now: () => new Date((clock += 1000)),
    waiting: (_project, id) => (waiting.has(id) ? 'slot' : undefined),
    agentIds: async () => ['devin', 'mika'],
    agentName: async (id) =>
      id === 'mika' ? 'Mika' : id === 'devin' ? 'Devin' : Promise.reject(new Error('no agent')),
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

  const root = commented.comments.at(-1)!.id;
  const reply = await service.comment({
    project: 'change-elections',
    key: 'CE-1',
    body: 'Agreed',
    parent: root,
  });
  const first = reply.comments.at(-1)!;
  assert.equal(first.parent, root);
  const nested = await service.comment({
    project: 'change-elections',
    key: 'CE-1',
    body: 'Same thread',
    parent: first.id,
  });
  assert.equal(nested.comments.at(-1)?.parent, root, 'a reply to a reply joins the thread');
  await assert.rejects(
    service.comment({ project: 'change-elections', key: 'CE-1', body: 'Lost', parent: 'missing' }),
    /replied to is gone/,
  );
});

test('a task records who created it, and planning dates set, clear, and stay in order', async (t) => {
  const { service } = await setup(t);
  const mine = await service.create({ project: 'change-elections', title: 'Mine' });
  assert.equal(mine.created_by, 'you');
  const theirs = await service.create({ project: 'change-elections', title: 'Theirs', created_by: 'devin' });
  assert.equal(theirs.created_by, 'devin');

  const planned = await service.update({
    project: 'change-elections',
    key: mine.key,
    start_date: '2026-12-01',
    due_date: '2026-12-05',
  });
  assert.deepEqual([planned.start_date, planned.due_date], ['2026-12-01', '2026-12-05']);
  assert.deepEqual(
    planned.events.slice(1).map((e) => e.message),
    ['Set the start date to 2026-12-01', 'Set the due date to 2026-12-05'],
  );
  await assert.rejects(
    service.update({ project: 'change-elections', key: mine.key, due_date: '2026-11-30' }),
    /due date is before the start date/,
  );
  await assert.rejects(
    service.update({ project: 'change-elections', key: mine.key, due_date: '12/05/2026' }),
    /YYYY-MM-DD/,
  );
  const cleared = await service.update({ project: 'change-elections', key: mine.key, start_date: null });
  assert.equal(cleared.start_date, undefined);
  assert.equal(cleared.due_date, '2026-12-05');
  assert.equal(cleared.events.at(-1)?.message, 'Removed the start date');
  const same = await service.update({ project: 'change-elections', key: mine.key, due_date: '2026-12-05' });
  assert.equal(same.events.length, cleared.events.length, 'the same date adds no event');
});

test('moving without a run only sets the status', async (t) => {
  const { service, calls } = await setup(t);
  await service.create({ project: 'change-elections', title: 'Idea' });
  const moved = await service.move({ project: 'change-elections', key: 'CE-1', to: 'todo' });
  assert.equal(moved.action, 'set-status');
  assert.equal(moved.issue.status, 'todo');
  assert.deepEqual(
    { ...moved.issue.events.at(-1), at: undefined },
    {
      at: undefined,
      kind: 'move:todo',
      message: 'Changed status from Backlog to Todo',
      from: 'backlog',
      to: 'todo',
    },
  );
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

test('a waiting run closes when its task goes back to Todo, and the task waits there', async (t) => {
  const stuck = run('Stuck', '2026-11-18T10:00:00.000Z', 'blocked');
  const { service, calls } = await setup(t, [stuck]);
  const moved = await service.move({ project: 'change-elections', key: 'CE-1', to: 'todo' });
  assert.equal(moved.action, 'requeue');
  assert.deepEqual(calls, [`reject:${stuck.id}:Moved back to Todo from the task board.`]);
  assert.equal(moved.issue.status, 'todo');
  assert.match(moved.issue.events.at(-1)!.message, /Closed the open run and moved the task back to Todo/);
  // The closed run has ended, so In progress starts a new one.
  const again = await service.move({ project: 'change-elections', key: 'CE-1', to: 'in_progress' });
  assert.equal(again.action, 'start-run');
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

test('archived tasks keep their data and can be restored, but not while a run works', async (t) => {
  const working = run('Busy', '2026-11-18T10:00:00.000Z', 'coding');
  const { service } = await setup(t, [working]);
  await service.create({ project: 'change-elections', title: 'Idea' });
  const archived = await service.archive({ project: 'change-elections', key: 'CE-2', archived: true });
  assert.ok(archived.archived_at);
  assert.equal((await service.list('change-elections')).items.length, 2, 'list still returns archived tasks');
  const restored = await service.archive({ project: 'change-elections', key: 'CE-2', archived: false });
  assert.equal(restored.archived_at, undefined);
  assert.deepEqual(
    restored.events.map((e) => e.kind),
    ['created', 'archived', 'restored'],
  );
  await assert.rejects(
    service.archive({ project: 'change-elections', key: 'CE-1', archived: true }),
    Conflict,
  );
});

test('delete needs an archived task, removes its runs, and never brings them back', async (t) => {
  const old = run('Old run', '2026-11-18T10:00:00.000Z', 'rejected');
  const { root, service, calls, tasks } = await setup(t, [old]);
  await assert.rejects(service.delete({ project: 'change-elections', key: 'CE-1' }), /Archive the task/);
  await service.archive({ project: 'change-elections', key: 'CE-1', archived: true });
  const result = await service.delete({ project: 'change-elections', key: 'CE-1' });
  assert.deepEqual(result, { key: 'CE-1', failed: [] });
  assert.deepEqual(calls, [`delete:${old.id}`]);
  assert.equal(tasks.length, 0);
  assert.deepEqual((await service.list('change-elections')).items, []);
  const stored = JSON.parse(await readFile(join(root, 'change-elections', 'issues.json'), 'utf8'));
  assert.deepEqual(stored.deleted_runs, [old.id]);
  const next = await service.create({ project: 'change-elections', title: 'After' });
  assert.equal(next.key, 'CE-2', 'numbers are never reused');
});

test('a run that fails to delete is reported and still stays off the board', async (t) => {
  const stuck = run('Stuck run', '2026-11-18T10:00:00.000Z', 'failed');
  const { service } = await setup(t, [stuck], {}, stuck.id);
  await service.archive({ project: 'change-elections', key: 'CE-1', archived: true });
  const result = await service.delete({ project: 'change-elections', key: 'CE-1' });
  assert.deepEqual(result.failed, [{ run: stuck.id, error: 'git refused' }]);
  assert.deepEqual(
    (await service.list('change-elections')).items,
    [],
    'the leftover run is not wrapped again',
  );
});

test('a turn queued behind a busy agent shows as waiting in Todo, not as its old Blocked stage', async (t) => {
  const stuck = run('Update deps', '2026-11-18T10:00:00.000Z', 'blocked');
  const waiting = new Set<string>();
  const { service } = await setup(t, [stuck], {}, undefined, waiting);
  assert.equal((await service.get({ project: 'change-elections', key: 'CE-1' })).status, 'blocked');
  waiting.add(stuck.id);
  const queued = await service.get({ project: 'change-elections', key: 'CE-1' });
  assert.equal(queued.status, 'todo');
  assert.equal(queued.run?.waiting, true);
  assert.equal(queued.run?.waiting_for, 'slot');
  assert.equal(queued.run?.stage, 'blocked', 'the run itself is unchanged until it starts');
});

test('a task with a queued turn cannot be archived or deleted, so the turn never starts on a removed run', async (t) => {
  const stuck = run('Update deps', '2026-11-18T10:00:00.000Z', 'blocked');
  const waiting = new Set<string>();
  const { service } = await setup(t, [stuck], {}, undefined, waiting);
  await service.archive({ project: 'change-elections', key: 'CE-1', archived: true });
  waiting.add(stuck.id);
  await assert.rejects(service.delete({ project: 'change-elections', key: 'CE-1' }), Conflict);
  await service.archive({ project: 'change-elections', key: 'CE-1', archived: false });
  await assert.rejects(
    service.archive({ project: 'change-elections', key: 'CE-1', archived: true }),
    Conflict,
  );
  await assert.rejects(service.move({ project: 'change-elections', key: 'CE-1', to: 'backlog' }), /queued/);
});

test('a task view says whether a live run holds its latest run', async (t) => {
  const live = run('Live run', '2026-11-20T10:00:00.000Z', 'failed');
  const stopped = run('Stopped run', '2026-11-21T10:00:00.000Z', 'coding');
  const root = await mkdtemp(join(tmpdir(), 'factory-issues-owned-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => [live, stopped] },
    owned: (_project, id) => id === live.id,
    settings: async () => ({
      task_manager: { kind: 'none' },
      tending: { enabled: false, answer_threads: false, trusted_logins: [] },
    }),
    submit: async () => '',
    run: async () => undefined,
    reject: async () => undefined,
    deleteRun: async () => undefined,
  } as ConstructorParameters<typeof IssueService>[0]);
  const { items } = await service.list('change-elections');
  assert.deepEqual(
    items.map((i) => [i.run!.stage, i.run!.owned]),
    [
      ['failed', true],
      ['coding', false],
    ],
  );
});

test('an interrupted run at coding can be archived and deleted; a live run cannot', async (t) => {
  const live = run('Live run', '2026-11-20T10:00:00.000Z', 'failed');
  const stopped = run('Stopped run', '2026-11-21T10:00:00.000Z', 'coding');
  const root = await mkdtemp(join(tmpdir(), 'factory-issues-held-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const deleted: string[] = [];
  const service = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => [live, stopped] },
    owned: (_project, id) => id === live.id,
    settings: async () => ({
      task_manager: { kind: 'none' },
      tending: { enabled: false, answer_threads: false, trusted_logins: [] },
    }),
    submit: async () => '',
    run: async () => undefined,
    reject: async () => undefined,
    deleteRun: async (_project, id) => void deleted.push(id),
  } as ConstructorParameters<typeof IssueService>[0]);
  const { items } = await service.list('change-elections');
  const key = (id: string) => items.find((i) => i.run!.id === id)!.key;
  await assert.rejects(
    service.archive({ project: 'change-elections', key: key(live.id), archived: true }),
    Conflict,
  );
  const archived = await service.archive({
    project: 'change-elections',
    key: key(stopped.id),
    archived: true,
  });
  assert.ok(archived.archived_at);
  await service.delete({ project: 'change-elections', key: key(stopped.id) });
  assert.deepEqual(deleted, [stopped.id]);
});

test('Cancelled takes a queued turn out of the queue before it rejects the run', async (t) => {
  const stuck = run('Update deps', '2026-11-18T10:00:00.000Z', 'blocked');
  const { service, calls } = await setup(t, [stuck], {}, undefined, new Set([stuck.id]));
  await service.move({ project: 'change-elections', key: 'CE-1', to: 'cancelled' });
  assert.deepEqual(
    calls.filter((c) => /^(cancelQueued|reject):/.test(c)).map((c) => c.split(':')[0]),
    ['cancelQueued', 'reject'],
  );
});

test('a follow-up on a task whose PR is open goes to its agent, and a drop to In progress points to it', async (t) => {
  const pr = {
    url: 'https://github.com/o/r/pull/4',
    branch: 'factory/x',
    head_sha: 'h1',
    at: '2026-11-18T10:00:00.000Z',
  };
  const opened = run('Ship it', '2026-11-18T10:00:00.000Z', 'pr-opened', {
    workflow: 'agent',
    agent: 'devin',
    pr,
  });
  const working = run('Still coding', '2026-11-18T11:00:00.000Z', 'coding');
  const { service, calls } = await setup(t, [opened, working]);
  await assert.rejects(
    service.move({ project: 'change-elections', key: 'CE-1', to: 'in_progress' }),
    /Add a follow-up with instructions from the task page/,
  );
  const view = await service.followUp({
    project: 'change-elections',
    key: 'CE-1',
    note: 'Fix the copy\nand more',
  });
  assert.ok(calls.includes(`followUp:${opened.id}:custom:devin:you:`), calls.join('\n'));
  assert.equal(view.events.at(-1)?.message, 'Added a follow-up for Devin: Fix the copy');
  assert.equal(view.assignee, 'devin', 'the agent becomes the assignee of an unassigned task');

  await service.followUp({
    project: 'change-elections',
    key: opened.id,
    note: 'Resolve the conflicts.',
    kind: 'conflicts',
    by: 'factory',
    pr_head: 'h1',
    agent: 'mika',
  });
  assert.ok(calls.includes(`followUp:${opened.id}:conflicts:mika:factory:h1`), 'a run id finds the task');
  await assert.rejects(
    service.followUp({ project: 'change-elections', key: 'CE-2', note: 'Go' }),
    /continues a task whose pull request is open/,
  );
});

test('a second follow-up is refused while one waits for its agent', async (t) => {
  const pr = {
    url: 'https://github.com/o/r/pull/4',
    branch: 'factory/x',
    head_sha: 'h1',
    at: '2026-11-18T10:00:00.000Z',
  };
  const opened = run('Ship it', '2026-11-18T10:00:00.000Z', 'pr-opened', {
    workflow: 'agent',
    agent: 'devin',
    pr,
  });
  const { service, calls } = await setup(t, [opened], {}, undefined, new Set([opened.id]));
  await assert.rejects(
    service.followUp({ project: 'change-elections', key: 'CE-1', note: 'Again' }),
    /already queued or working/,
  );
  assert.ok(!calls.some((c) => c.startsWith('followUp:')), 'nothing was queued');
});

test('a comment on a blocked agent task reaches the agent as its reply', async (t) => {
  const blocked = run('Ship it', '2026-11-18T10:00:00.000Z', 'blocked', {
    workflow: 'agent',
    agent: 'devin',
  });
  const { service, calls } = await setup(t, [blocked]);
  await service.comment({ project: 'change-elections', key: 'CE-1', body: 'Use the staging API.' });
  assert.ok(calls.includes(`reply:${blocked.id}:Use the staging API.`), calls.join('\n'));
});

test('@mentions are stored and route the comment: the run agent continues, an open PR gets a follow-up, an unassigned task gets the agent', async (t) => {
  const pr = {
    url: 'https://github.com/o/r/pull/4',
    branch: 'factory/x',
    head_sha: 'h1',
    at: '2026-11-18T10:00:00.000Z',
  };
  const opened = run('Ship it', '2026-11-18T10:00:00.000Z', 'pr-opened', {
    workflow: 'agent',
    agent: 'devin',
    pr,
  });
  const blocked = run('Ask me', '2026-11-18T11:00:00.000Z', 'blocked', { workflow: 'agent', agent: 'devin' });
  const { service, calls } = await setup(t, [opened, blocked]);

  // CE-1: the PR is open, so @mika gets a follow-up with the comment as its note.
  const followed = await service.comment({
    project: 'change-elections',
    key: 'CE-1',
    body: '@mika check the copy, not `@devin`',
  });
  assert.deepEqual(followed.comments.at(-1)?.mentions, ['mika'], 'a mention in code is not a mention');
  assert.ok(calls.includes(`followUp:${opened.id}:custom:mika:you:`), calls.join('\n'));

  // CE-2: blocked on Devin. @devin continues Devin's session with the comment.
  await service.comment({ project: 'change-elections', key: 'CE-2', body: 'Raise it @Devin' });
  assert.ok(calls.includes(`reply:${blocked.id}:Raise it @Devin`), calls.join('\n'));
  // @mika on Devin's blocked run starts nothing and says why.
  const other = await service.comment({
    project: 'change-elections',
    key: 'CE-2',
    body: '@mika take a look',
  });
  assert.match(other.events.at(-1)?.message ?? '', /Mika was mentioned, but another agent works this run/);

  // A new task without a run or an agent: the mentioned agent is assigned.
  const fresh = await service.create({ project: 'change-elections', title: 'New' });
  const assigned = await service.comment({ project: 'change-elections', key: fresh.key, body: 'Hi @mika' });
  assert.equal(assigned.assignee, 'mika');
  // Unknown names and agents' own comments route nothing.
  const before = calls.length;
  const unknown = await service.comment({
    project: 'change-elections',
    key: fresh.key,
    body: '@nobody hello',
  });
  assert.equal(unknown.comments.at(-1)?.mentions, undefined);
  await service.comment({ project: 'change-elections', key: 'CE-1', body: '@mika again', author: 'devin' });
  assert.equal(calls.length, before, 'no call for an unknown mention or an agent comment');
});

test('a merged PR moves its task to Done once, a closed one to Cancelled, a reopened one back to In review', async (t) => {
  const pr = {
    url: 'https://github.com/o/r/pull/5',
    branch: 'factory/x',
    head_sha: 'h1',
    at: '2026-11-18T10:00:00.000Z',
  };
  const opened = run('Update Effect', '2026-11-18T10:00:00.000Z', 'pr-opened', {
    workflow: 'agent',
    agent: 'devin',
    pr,
  });
  const { service } = await setup(t, [opened]);
  assert.equal(
    (await service.get({ project: 'change-elections', key: 'CE-1' })).status,
    'in_review',
    'open PR: in review',
  );

  const merged = await service.prOutcome('change-elections', opened.id, { number: 5, state: 'MERGED' });
  assert.equal(merged?.status, 'done');
  assert.deepEqual([merged?.pr_outcome?.state, merged?.pr_outcome?.number], ['MERGED', 5]);
  assert.equal(merged?.events.at(-1)?.message, 'PR #5 was merged. The task is done.');
  assert.equal(
    await service.prOutcome('change-elections', opened.id, { number: 5, state: 'MERGED' }),
    undefined,
    'recorded once',
  );

  const reopened = await service.prOutcome('change-elections', opened.id, { number: 5, state: 'OPEN' });
  assert.equal(reopened?.status, 'in_review');
  assert.equal(reopened?.pr_outcome, undefined);
  const closed = await service.prOutcome('change-elections', opened.id, { number: 5, state: 'CLOSED' });
  assert.equal(closed?.status, 'cancelled');
  assert.equal(
    await service.prOutcome('change-elections', 'not-a-run', { number: 5, state: 'MERGED' }),
    undefined,
  );
});

test('a recorded merge sets Done again when a later run stage moved the task back to In review', async (t) => {
  const pr = {
    url: 'https://github.com/o/r/pull/5',
    branch: 'factory/x',
    head_sha: 'h1',
    at: '2026-11-18T10:00:00.000Z',
  };
  const opened = run('Update Effect', '2026-11-18T10:00:00.000Z', 'pr-opened', {
    workflow: 'agent',
    agent: 'devin',
    pr,
  });
  const { service, tasks } = await setup(t, [opened]);
  const merged = await service.prOutcome('change-elections', opened.id, { number: 5, state: 'MERGED' });
  // A follow-up ran on meanwhile and was settled back to pr-opened after the merge was recorded.
  const later = new Date(Date.parse(merged!.status_at) + 500).toISOString();
  tasks[0] = { ...opened, stage: 'pr-opened', updated_at: later };
  assert.equal((await service.get({ project: 'change-elections', key: 'CE-1' })).status, 'in_review');
  const again = await service.prOutcome('change-elections', opened.id, { number: 5, state: 'MERGED' });
  assert.equal(again?.status, 'done');
  assert.equal(again?.events.filter((e) => e.kind === 'pr-outcome').length, 1, 'the merge is recorded once');
});

test("@mentioning the run's own agent on an open PR starts a follow-up for it", async (t) => {
  const pr = {
    url: 'https://github.com/o/r/pull/5',
    branch: 'factory/x',
    head_sha: 'h1',
    at: '2026-11-18T10:00:00.000Z',
  };
  const opened = run('Update Effect', '2026-11-18T10:00:00.000Z', 'pr-opened', {
    workflow: 'agent',
    agent: 'devin',
    pr,
  });
  const { service, calls } = await setup(t, [opened]);
  const view = await service.comment({
    project: 'change-elections',
    key: 'CE-1',
    body: '@mika @devin Fix the copy in the PR',
  });
  assert.ok(calls.includes(`followUp:${opened.id}:custom:devin:you:`), calls.join('\n'));
  assert.match(view.events.at(-1)?.message ?? '', /Added a follow-up for Devin: @mika @devin Fix the copy/);
});

test('a follow-up asking to merge main or resolve conflicts runs as a conflicts follow-up (the factory merges)', async (t) => {
  const pr = {
    url: 'https://github.com/o/r/pull/5',
    branch: 'factory/x',
    head_sha: 'h1',
    at: '2026-11-18T10:00:00.000Z',
  };
  const opened = run('Update Effect', '2026-11-18T10:00:00.000Z', 'pr-opened', {
    workflow: 'agent',
    agent: 'devin',
    pr,
  });
  const { service, calls } = await setup(t, [opened]);
  await service.comment({
    project: 'change-elections',
    key: 'CE-1',
    body: '@devin Merge main into this branch and run the tests',
  });
  assert.ok(calls.includes(`followUp:${opened.id}:conflicts:devin:you:`), calls.join('\n'));
});
