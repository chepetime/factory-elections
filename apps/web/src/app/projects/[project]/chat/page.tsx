import type { Metadata } from 'next';
import { NewChat } from '@/components/agent-chat';
import { listAgents } from '@/lib/agents';
import { notFound } from 'next/navigation';
import { isProjectName } from '@/lib/factory';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Chat' };

export default async function ChatHome({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams?: Promise<{ agent?: string }>;
}) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const { agent } = (await searchParams) ?? {};
  const agents = await listAgents();
  if (!agents.ok)
    return (
      <p role="alert" className="p-6 text-destructive">
        Agents unavailable: {agents.error}
      </p>
    );
  return (
    <NewChat
      agents={agents.value.filter((a) => !a.archived_at)}
      project={project}
      {...(agent ? { initialAgent: agent } : {})}
    />
  );
}
