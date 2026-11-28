import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentProfile, TaskRecord } from '@factory/core';
import { handoffAgent } from '../src/run-agent.ts';
import { CommandSchema } from '../src/run-record.ts';

test('resuming a reassigned run selects the new agent or refuses their unsupported model', async () => {
  const at = '2026-11-28T00:00:00.000Z';
  const task = TaskRecord.parse({
    project: 'demo',
    id: 'c8da9027-b067-4abe-9071-bab48c7c1271',
    repo: '/tmp/demo',
    prompt: 'Write a README',
    stage: 'blocked',
    workflow: 'agent',
    agent: 'devin',
    created_at: at,
    updated_at: at,
    agent_session: 'devin-session',
  });
  const command = CommandSchema.parse({ project: task.project, id: task.id, action: 'run' });
  const carlos = AgentProfile.parse({ id: 'carlos', name: 'Carlos', created_at: at, updated_at: at });
  assert.equal(
    await handoffAgent(
      command,
      task,
      async () => carlos.id,
      async () => carlos,
    ),
    carlos.id,
  );
  await assert.rejects(
    handoffAgent(
      command,
      task,
      async () => carlos.id,
      async () => ({ ...carlos, model: 'codex:unpriced' }),
    ),
    /Carlos: codex:unpriced has no price/,
  );
  assert.equal(
    await handoffAgent(
      command,
      task,
      async () => undefined,
      async () => carlos,
    ),
    undefined,
  );
  assert.equal(
    await handoffAgent(
      { ...command, action: 'check' },
      task,
      async () => carlos.id,
      async () => carlos,
    ),
    undefined,
  );
});
