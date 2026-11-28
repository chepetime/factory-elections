import {
  Conflict,
  boardModelRefusal,
  pendingAgentHandoff,
  type AgentProfile,
  type TaskRecord,
} from '@factory/core';
import type { RunCommand } from './run-record.ts';

export async function handoffAgent(
  command: RunCommand,
  task: TaskRecord,
  assigneeForRun: () => Promise<string | undefined>,
  activeAgent: (id: string) => Promise<AgentProfile>,
): Promise<string | undefined> {
  if (task.workflow !== 'agent' || (command.action !== 'run' && command.action !== 'revise'))
    return undefined;
  const id = await assigneeForRun();
  if (!id || !pendingAgentHandoff(task, id)) return undefined;
  const agent = await activeAgent(id);
  const refusal = boardModelRefusal(agent.model);
  if (refusal) throw new Conflict(`${agent.name}: ${refusal}`);
  return id;
}

export async function runLabel(
  task: TaskRecord,
  command: RunCommand,
  nameOf: (id: string) => Promise<string>,
  handoff?: string,
): Promise<string> {
  const { action } = command;
  if (action === 'check') return 'Running checks';
  if (action === 'follow-up' || task.workflow === 'agent') {
    const id = (action === 'follow-up' ? command.agent : handoff) || task.agent;
    const name = id ? await nameOf(id) : 'Agent';
    if (action === 'follow-up') return `${name}: follow-up on the open PR → commit → checks`;
    return action === 'run'
      ? `${name}: session → commit → checks`
      : `${name} read your reply: session → commit → checks`;
  }
  return action === 'run' ? 'Running classify → code → verify → review' : 'Revising: code → verify → review';
}
