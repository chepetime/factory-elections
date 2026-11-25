import type { Metadata } from 'next';
import { NewChat } from '@/components/agent-chat';
import { listAgents } from '@/lib/agents';
import { listProjects } from '@/lib/factory';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Chat' };

export default async function ChatHome({ searchParams }: { searchParams?: Promise<{ agent?: string }> }) {
  const { agent } = (await searchParams) ?? {};
  const [agents, projects] = await Promise.all([listAgents(), listProjects()]);
  if (!agents.ok)
    return (
      <p role="alert" className="p-6 text-destructive">
        Agents unavailable: {agents.error}
      </p>
    );
  return (
    <NewChat
      agents={agents.value.filter((a) => !a.archived_at)}
      projects={
        projects.ok ? projects.value.map((p) => ({ name: p.name, label: p.display_name || p.name })) : []
      }
      {...(agent ? { initialAgent: agent } : {})}
    />
  );
}
