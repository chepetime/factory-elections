'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  archiveAgentRun,
  createAgentRun,
  deleteChatRun,
  renameChatRun,
  sendChatRun,
  startChatRun,
  stopChatRun,
  updateAgentRun,
} from '@/lib/agents';
import { isProjectName } from '@/lib/factory';

/** Route patterns, so one revalidation covers the pages in every project. */
const CHAT_PAGES = '/projects/[project]/chat';
const AGENT_PAGES = '/projects/[project]/agents';

export type AgentActionState = { error?: string; message?: string };
const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createAgent(input: {
  name: string;
  avatar?: string;
  description?: string;
  model?: string;
  auto_pickup?: boolean;
}): Promise<AgentActionState & { id?: string }> {
  if (!input.name.trim()) return { error: 'Give the agent a name.' };
  const result = await createAgentRun(input);
  if (!result.ok) return { error: result.error };
  revalidatePath(AGENT_PAGES, 'layout');
  return { id: result.value.id, message: `Created ${result.value.name}.` };
}

/** Saves some of an agent's fields; the backend validates them. */
export async function updateAgent(id: string, patch: Record<string, unknown>): Promise<AgentActionState> {
  if (!AGENT_ID.test(id)) return { error: 'Invalid agent.' };
  const result = await updateAgentRun({ ...patch, id });
  if (!result.ok) return { error: result.error };
  revalidatePath(AGENT_PAGES, 'layout');
  return { message: 'Saved.' };
}

export async function archiveAgent(id: string, archived: boolean): Promise<AgentActionState> {
  if (!AGENT_ID.test(id)) return { error: 'Invalid agent.' };
  const result = await archiveAgentRun(id, archived);
  if (!result.ok) return { error: result.error };
  revalidatePath(AGENT_PAGES, 'layout');
  return { message: archived ? 'Archived.' : 'Restored.' };
}

/** Opens a new chat with the agent in the project, and goes to it. */
export async function startChat(agent: string, project: string): Promise<AgentActionState> {
  if (!AGENT_ID.test(agent)) return { error: 'Invalid agent.' };
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  const result = await startChatRun(agent, project);
  if (!result.ok) return { error: result.error };
  revalidatePath(CHAT_PAGES, 'layout');
  redirect(`/projects/${project}/chat/${result.value.id}`);
}

export async function sendChat(id: string, text: string): Promise<AgentActionState> {
  if (!CHAT_ID.test(id)) return { error: 'Invalid chat.' };
  if (!text.trim()) return { error: 'Write a message first.' };
  const result = await sendChatRun(id, text);
  if (!result.ok) return { error: result.error };
  revalidatePath(CHAT_PAGES, 'layout');
  return {};
}

export async function stopChat(id: string): Promise<AgentActionState> {
  if (!CHAT_ID.test(id)) return { error: 'Invalid chat.' };
  const result = await stopChatRun(id);
  return result.ok ? {} : { error: result.error };
}

export async function renameChat(id: string, title: string): Promise<AgentActionState> {
  if (!CHAT_ID.test(id)) return { error: 'Invalid chat.' };
  const result = await renameChatRun(id, title);
  if (!result.ok) return { error: result.error };
  revalidatePath(CHAT_PAGES, 'layout');
  return {};
}

export async function deleteChat(id: string, project: string): Promise<AgentActionState> {
  if (!CHAT_ID.test(id)) return { error: 'Invalid chat.' };
  if (!isProjectName(project)) return { error: 'Invalid project.' };
  const result = await deleteChatRun(id);
  if (!result.ok) return { error: result.error };
  revalidatePath(CHAT_PAGES, 'layout');
  redirect(`/projects/${project}/chat`);
}
