import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentProfile, type IssueView, type TaskRecord } from '@factory/core';
import { buildAgentSession } from '../src/agent-sessions.ts';

const at = '2026-11-26T00:00:00.000Z';
const agent = AgentProfile.parse({ id: 'devin', name: 'Devin', created_at: at, updated_at: at });
const issue = { key: 'FE-1', title: 'Add it', description: 'Add it.', comments: [] } as unknown as IssueView;
const issues = { get: async () => issue, comment: async () => issue, setStatus: async () => issue };
const task = { id: 'FE-1', project: 'demo', agent_session: 'sess-1' } as unknown as TaskRecord;
const profile = { test: 'pnpm test', full_check: 'pnpm check', forbidden_paths: [] };

test("Factory's fix message reaches the agent as Factory's, not as a person's reply", async () => {
  const person = await buildAgentSession({ task, reply: 'Rename it', agent, issues, profile });
  assert.match(person.prompt, /^The person replied on FE-1:\n\nRename it/);
  const factory = await buildAgentSession({
    task,
    reply: 'Verification failed',
    from: 'factory',
    agent,
    issues,
    profile,
  });
  assert.match(factory.prompt, /^Factory on FE-1:\n\nVerification failed/);
  assert.doesNotMatch(factory.prompt, /person replied/);
});

test("every task session states Factory's gates before the agent starts", async () => {
  const { systemPrompt } = await buildAgentSession({ task, agent, issues, profile });
  assert.match(systemPrompt, /400 non-test lines/);
  assert.match(systemPrompt, /weakens tests/);
  assert.match(systemPrompt, /check_change/);
  assert.match(systemPrompt, /delegate/);
  assert.match(systemPrompt, /background/);
});
