import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentChat, AgentProfile, agentSlug, Issue } from '../src/index.ts';

const at = '2026-11-25T00:00:00.000Z';

test('an agent gets safe defaults and refuses stored secrets', () => {
  const agent = AgentProfile.parse({ id: 'mika', name: 'Mika', created_at: at, updated_at: at });
  assert.equal(agent.model, 'claude-sonnet-5-5');
  assert.equal(agent.concurrency, 1);
  assert.deepEqual([agent.skills, agent.mcp, agent.pass_env], [[], [], []]);
  assert.equal(AgentProfile.safeParse({ ...agent, pass_env: ['token=abc'] }).success, false);
  assert.equal(AgentProfile.safeParse({ ...agent, model: 'gpt-5' }).success, false);
  assert.equal(
    AgentProfile.safeParse({ ...agent, mcp: [{ name: 'linear', url: 'ftp://x' }] }).success,
    false,
  );
});

test('agent ids come from names', () => {
  assert.equal(agentSlug('Ada Lovelace'), 'ada-lovelace');
  assert.equal(agentSlug('  Señor QA! '), 'senor-qa');
  assert.equal(agentSlug('***'), 'agent');
});

test('a chat starts empty, and issue comments default to you', () => {
  const chat = AgentChat.parse({
    id: '11111111-2222-4333-8444-555555555555',
    agent: 'mika',
    title: 'New chat',
    created_at: at,
    updated_at: at,
  });
  assert.deepEqual([chat.turns, chat.working], [[], false]);
  const issue = Issue.parse({
    number: 1,
    title: 'T',
    status: 'todo',
    status_at: at,
    comments: [{ id: 'c', at, body: 'hi' }],
    created_at: at,
    updated_at: at,
  });
  assert.equal(issue.comments[0]!.author, 'you');
  assert.equal(issue.assignee, undefined);
});

test('free agents pick their Todo tasks, most urgent then oldest, within their slots', async () => {
  const { pickupPlan } = await import('../src/index.ts');
  const agents = [
    { id: 'devin', concurrency: 2, auto_pickup: true },
    { id: 'mika', concurrency: 1, auto_pickup: false },
    { id: 'old', concurrency: 1, auto_pickup: true, archived_at: at },
  ];
  const task = (key: string, extra: Record<string, unknown> = {}) => ({
    project: 'demo',
    key,
    assignee: 'devin',
    status: 'todo',
    priority: 'none' as const,
    created_at: `2026-11-0${key.slice(-1)}T00:00:00.000Z`,
    archived: false,
    ...extra,
  });
  const tasks = [
    task('D-1'),
    task('D-2', { priority: 'urgent' }),
    task('D-3'),
    task('D-4', { status: 'backlog' }),
    task('D-5', { run_stage: 'awaiting-approval' }),
    task('D-6', { run_stage: 'rejected', priority: 'high' }),
    task('D-7', { archived: true }),
    task('D-8', { assignee: 'mika' }),
    task('D-9', { assignee: 'old' }),
  ];
  const keys = (busy: Map<string, number>, skip?: (t: { key: string }) => boolean) =>
    pickupPlan(agents, tasks, busy, skip).map((t) => t.key);
  assert.deepEqual(keys(new Map()), ['D-2', 'D-6']);
  assert.deepEqual(keys(new Map([['devin', 1]])), ['D-2']);
  assert.deepEqual(keys(new Map([['devin', 2]])), []);
  assert.deepEqual(
    keys(new Map(), (t) => t.key === 'D-2'),
    ['D-6', 'D-1'],
  );
});
