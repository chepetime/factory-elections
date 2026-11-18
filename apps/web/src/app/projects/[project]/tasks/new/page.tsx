import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectHome } from '@/components/project-home';
import { isProjectName, listTasks } from '@/lib/factory';
import { gitUserName } from '@/lib/team';
import { projectTitle } from '@/lib/page-title';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'New task') : 'New task' };
}
export const dynamic = 'force-dynamic';

export default async function NewTaskPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const [tasks, userName] = await Promise.all([listTasks(project), gitUserName(project)]);
  return <ProjectHome project={project} tasks={tasks.ok ? tasks.value : undefined} userName={userName} />;
}
