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
