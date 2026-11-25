import { Plus } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { ChatList } from '@/components/agent-chat';
import { listAgents, listChats } from '@/lib/agents';

export const dynamic = 'force-dynamic';

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const [chats, agents] = await Promise.all([listChats(), listAgents()]);
  const byId = new Map((agents.ok ? agents.value : []).map((a) => [a.id, a]));
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside
        aria-label="Chats"
        className="flex min-h-0 shrink-0 flex-col border-b md:w-72 md:border-r md:border-b-0"
      >
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-sm font-semibold">Chat</h1>
          <Link
            href="/chat"
            aria-label="New chat"
            title="New chat"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Plus className="size-4" aria-hidden />
          </Link>
        </div>
        {!chats.ok ? (
          <p role="alert" className="px-4 pb-3 text-sm text-destructive">
            Chats unavailable: {chats.error}
          </p>
        ) : chats.value.length === 0 ? (
          <p className="px-4 pb-3 text-sm text-muted-foreground">No chats yet.</p>
        ) : (
          <ChatList
            chats={chats.value.map((c) => {
              const agent = byId.get(c.agent);
              return {
                ...c,
                avatar: <AgentAvatar agent={agent ?? { name: c.agent, avatar: '🤖' }} decorative />,
                agentName: agent?.name ?? c.agent,
              };
            })}
          />
        )}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
