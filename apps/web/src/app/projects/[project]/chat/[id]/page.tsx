import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChatThread } from '@/components/agent-chat';
import { getChat, listAgents } from '@/lib/agents';
import { isProjectName } from '@/lib/factory';

export const dynamic = 'force-dynamic';
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!CHAT_ID.test(id)) return { title: 'Chat' };
  const chat = await getChat(id);
  return { title: chat.ok ? `${chat.value.title} · Chat` : 'Chat' };
}

export default async function ChatPage({ params }: { params: Promise<{ project: string; id: string }> }) {
  const { project, id } = await params;
  if (!isProjectName(project) || !CHAT_ID.test(id)) notFound();
  const [chat, agents] = await Promise.all([getChat(id), listAgents()]);
  if (!chat.ok) {
    if (/not found/i.test(chat.error)) notFound();
    return (
      <p role="alert" className="p-6 text-destructive">
        Chat unavailable: {chat.error}
      </p>
    );
  }
  const agent = agents.ok ? agents.value.find((a) => a.id === chat.value.agent) : undefined;
  return (
    <ChatThread
      key={chat.value.id}
      project={project}
      initial={chat.value}
      agent={agent ?? { id: chat.value.agent, name: chat.value.agent, avatar: '🤖', description: '' }}
      archived={Boolean(agent?.archived_at)}
    />
  );
}
