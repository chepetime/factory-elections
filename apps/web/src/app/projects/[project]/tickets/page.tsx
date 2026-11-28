import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectTickets } from '@/components/project-tickets';
import { isProjectName } from '@/lib/factory';
import { projectTitle } from '@/lib/page-title';
import { listTickets } from '@/lib/tickets';
import { listIssues } from '@/lib/issues';

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
  const [result, issues] = await Promise.all([listTickets(project), listIssues(project)]);
  // Which task already links each ticket, so its card links there instead of offering a new task.
  const linked: Record<string, string> = {};
  for (const issue of issues.ok ? issues.value.items : [])
    if (!issue.archived_at) for (const l of issue.remote_tickets) linked[l.key] ??= issue.key;
  return (
    <ProjectTickets
      project={project}
      linked={linked}
      list={result.ok ? result.value : undefined}
      error={result.ok ? undefined : result.error}
    />
  );
}
