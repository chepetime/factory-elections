import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { storageFor } from '@factory/adapters-data';
import { chatTools, taskTools, type SessionReport } from '../src/agent-tools.ts';
import { DelegationServer } from '../src/delegation.ts';
import { IssueService } from '../src/issues.ts';

async function rpc(url: string, token: string, method: string, params?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await res.json()) as Record<string, any>;
}

test('an agent comments and reports status through its grant, and chats create tasks that start nothing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-agent-tools-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const submitted: string[] = [];
  const issues = new IssueService({
    root,
    storage: storageFor(root),
    tasks: { list: async () => [] },
    settings: async () => ({
      task_manager: { kind: 'none' },
      tending: { enabled: false, answer_threads: false },
    }),
    submit: async ({ prompt }) => (submitted.push(prompt), 'never'),
    run: async () => undefined,
    reject: async () => undefined,
    deleteRun: async () => undefined,
    agentName: async () => 'Mika',
  });
  await issues.create({ project: 'demo', title: 'Write the README', status: 'todo' });

  const server = new DelegationServer({
    runner: { run: async () => ({ text: '', costUsd: 0 }) },
    slot: async () => () => {},
  });
  const url = await server.start();
  t.after(() => server.close());
  const report: SessionReport = {};
  const agent = { id: 'mika', name: 'Mika' };
  const grant = server.grant({
    label: 'agent demo/DEM-1',
    cwd: root,
    access: 'edit',
    budgetUsd: 1,
    tools: taskTools({ issues, project: 'demo', key: 'DEM-1', agent, report }),
  })!;
  assert.deepEqual(grant.endpoint.tools, ['comment', 'set_status']);
  const token = grant.endpoint.token;

  const listed = await rpc(url, token, 'tools/list');
  assert.deepEqual(
    listed.result.tools.map((x: { name: string }) => x.name),
    ['delegate', 'comment', 'set_status'],
  );
  const posted = await rpc(url, token, 'tools/call', {
    name: 'comment',
    arguments: { body: 'Started on it.' },
  });
  assert.equal(posted.result.isError, false);
  const refused = await rpc(url, token, 'tools/call', { name: 'set_status', arguments: { status: 'done' } });
  assert.equal(refused.result.isError, true, 'done stays with the person');
  await rpc(url, token, 'tools/call', { name: 'set_status', arguments: { status: 'in_review' } });
  assert.equal(report.status, 'in_review');

  const issue = await issues.get({ project: 'demo', key: 'DEM-1' });
  assert.deepEqual(
    issue.comments.map((c) => [c.author, c.body]),
    [['mika', 'Started on it.']],
  );
  assert.equal(issue.status, 'in_review');
  assert.equal(issue.events.at(-1)?.message, 'Mika changed status from Todo to In review');

  const created: string[] = [];
  const chat = server.grant({
    label: 'chat mika',
    cwd: root,
    access: 'read-only',
    budgetUsd: 1,
    tools: chatTools({
      issues,
      projects: async () => ['demo'],
      agent,
      onCreated: (x) => created.push(x.key),
    }),
  })!;
  const made = await rpc(url, chat.endpoint.token, 'tools/call', {
    name: 'create_task',
    arguments: { project: 'demo', title: 'Add a staging link', assign_to_me: true },
  });
  assert.equal(made.result.content[0].text, 'Created DEM-2 in demo.');
  const missing = await rpc(url, chat.endpoint.token, 'tools/call', {
    name: 'create_task',
    arguments: { project: 'nope', title: 'X' },
  });
  assert.equal(missing.result.isError, true);
  const listedTasks = await rpc(url, chat.endpoint.token, 'tools/call', {
    name: 'list_tasks',
    arguments: { project: 'demo', status: 'todo' },
  });
  assert.equal(listedTasks.result.content[0].text, 'DEM-2 [todo] Add a staging link');
  assert.deepEqual(created, ['DEM-2']);
  const second = await issues.get({ project: 'demo', key: 'DEM-2' });
  assert.deepEqual([second.status, second.assignee], ['todo', 'mika']);
  assert.deepEqual(submitted, [], 'creating a task never starts a run');
});
