// Server-only bridge for workspace agents and their chats.
import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend/client';
import {
  AgentChat,
  AgentProfile,
  AGENT_CHAT_INSTRUCTIONS,
  AGENT_FACTORY_INSTRUCTIONS,
  IssuePriority,
  IssueStatus,
  Stage,
} from '@factory/core';
import { backendError, type Result } from '@/lib/factory';

export { AGENT_CHAT_INSTRUCTIONS, AGENT_FACTORY_INSTRUCTIONS };
export type { AgentProfile };

const RunLine = z.object({
  project: z.string(),
  id: z.string(),
  stage: Stage,
  created_at: z.string(),
  updated_at: z.string(),
  cost_usd: z.number(),
  key: z.string().optional(),
  title: z.string(),
});
export type AgentRunLine = z.infer<typeof RunLine>;
const AgentStats = z.object({
  agent: AgentProfile,
  skills_available: z.array(z.string()),
  env_allowed: z.array(z.string()),
  work: z.array(
    z.object({
      project: z.string(),
      key: z.string(),
      title: z.string(),
      status: IssueStatus,
      priority: IssuePriority,
      updated_at: z.string(),
    }),
  ),
  running: z.array(RunLine),
  runs: z.array(RunLine),
  last30: z.object({ runs: z.number(), completed: z.number(), cost_usd: z.number() }),
});
export type AgentStats = z.infer<typeof AgentStats>;

export const ChatView = AgentChat.extend({ partial: z.string().optional() });
export type ChatView = z.infer<typeof ChatView>;
const ChatSummary = z.object({
  id: z.string(),
  agent: z.string(),
  title: z.string(),
  project: z.string().optional(),
  last: z.string(),
  working: z.boolean(),
  updated_at: z.string(),
});
export type ChatSummary = z.infer<typeof ChatSummary>;

async function attempt<T>(call: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof z.ZodError ? 'The backend returned an invalid record.' : backendError(error),
    };
  }
}
type Method =
  | 'GetAgent'
  | 'CreateAgent'
  | 'UpdateAgent'
  | 'ArchiveAgent'
  | 'GetAgentStats'
  | 'ListChats'
  | 'GetChat'
  | 'StartChat'
  | 'SendChatMessage'
  | 'StopChat'
  | 'RenameChat'
  | 'DeleteChat';
async function call(method: Method, body: object): Promise<unknown> {
  return JSON.parse((await backendCall(method, { json: JSON.stringify(body) })).json);
}

export function listAgents(): Promise<Result<AgentProfile[]>> {
  return attempt(async () =>
    z.array(AgentProfile).parse(JSON.parse((await backendCall('ListAgents', {})).json)),
  );
}
export function agentStats(id: string): Promise<Result<AgentStats>> {
  return attempt(async () => AgentStats.parse(await call('GetAgentStats', { id })));
}
export function createAgentRun(input: object): Promise<Result<AgentProfile>> {
  return attempt(async () => AgentProfile.parse(await call('CreateAgent', input)));
}
export function updateAgentRun(input: object): Promise<Result<AgentProfile>> {
  return attempt(async () => AgentProfile.parse(await call('UpdateAgent', input)));
}
export function archiveAgentRun(id: string, archived: boolean): Promise<Result<AgentProfile>> {
  return attempt(async () => AgentProfile.parse(await call('ArchiveAgent', { id, archived })));
}

export function listChats(agent?: string): Promise<Result<ChatSummary[]>> {
  return attempt(async () => z.array(ChatSummary).parse(await call('ListChats', agent ? { agent } : {})));
}
export function getChat(id: string): Promise<Result<ChatView>> {
  return attempt(async () => ChatView.parse(await call('GetChat', { id })));
}
export function startChatRun(agent: string, project?: string): Promise<Result<ChatView>> {
  return attempt(async () =>
    ChatView.parse(await call('StartChat', { agent, ...(project ? { project } : {}) })),
  );
}
export function sendChatRun(id: string, text: string): Promise<Result<ChatView>> {
  return attempt(async () => ChatView.parse(await call('SendChatMessage', { id, text })));
}
export function stopChatRun(id: string): Promise<Result<unknown>> {
  return attempt(() => call('StopChat', { id }));
}
export function renameChatRun(id: string, title: string): Promise<Result<unknown>> {
  return attempt(() => call('RenameChat', { id, title }));
}
export function deleteChatRun(id: string): Promise<Result<unknown>> {
  return attempt(() => call('DeleteChat', { id }));
}
