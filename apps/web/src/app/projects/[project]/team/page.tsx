import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TeamTable } from '@/components/team-table';
import { isProjectName } from '@/lib/factory';
import { teamMembers } from '@/lib/team';
import { projectTitle } from '@/lib/page-title';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'Team') : 'Team' };
}
export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const members = await teamMembers(project);
  if (!members.ok) return <p className="p-6 text-destructive">Team unavailable: {members.error}</p>;
  return <TeamTable key={project} project={project} initial={members.value} />;
}
