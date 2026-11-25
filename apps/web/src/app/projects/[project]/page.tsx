import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectHome } from '@/components/project-home';
import { getInbox } from '@/lib/inbox';
import { recentIssues, withTaskKeys } from '@/lib/issues';
import { isProjectName, listTasks } from '@/lib/factory';
import { gitUserName } from '@/lib/team';
import { projectTitle } from '@/lib/page-title';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'Home') : 'Home' };
}
export const dynamic = 'force-dynamic';

export default async function ProjectHomePage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const [tasks, userName, inbox, issues] = await Promise.all([
    listTasks(project),
    gitUserName(project),
    getInbox(),
    recentIssues(project),
  ]);
  const named = inbox.ok
    ? { ...inbox, value: { ...inbox.value, items: await withTaskKeys(inbox.value.items) } }
    : inbox;
  return (
    <ProjectHome
      project={project}
      tasks={tasks.ok ? tasks.value : undefined}
      userName={userName}
      inbox={named}
      issues={issues}
    />
  );
}
