import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectTickets } from '@/components/project-tickets';
import { isProjectName } from '@/lib/factory';
import { projectTitle } from '@/lib/page-title';
import { listTickets } from '@/lib/tickets';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'Remote Tickets') : 'Remote Tickets' };
}

export default async function TicketsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const result = await listTickets(project);
  return (
    <ProjectTickets
      project={project}
      list={result.ok ? result.value : undefined}
      error={result.ok ? undefined : result.error}
    />
  );
}
