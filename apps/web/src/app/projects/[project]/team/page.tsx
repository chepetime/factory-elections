import { notFound } from 'next/navigation';
import { TeamTable } from '@/components/team-table';
import { isProjectName } from '@/lib/factory';
import { teamMembers } from '@/lib/team';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const members = await teamMembers(project);
  if (!members.ok) return <p className="p-6 text-destructive">Team unavailable: {members.error}</p>;
  return <TeamTable project={project} initial={members.value} />;
}
