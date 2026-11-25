import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArchivedTasks } from '@/components/archived-tasks';
import { isProjectName } from '@/lib/factory';
import { listIssues } from '@/lib/issues';
import { projectTitle } from '@/lib/page-title';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'Archived tasks') : 'Archived tasks' };
}
export const dynamic = 'force-dynamic';

export default async function ArchivedTasksPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const issues = await listIssues(project);
  if (!issues.ok)
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Archived tasks</h1>
        <p role="alert" className="mt-2 text-sm text-destructive">
          Archived tasks unavailable: {issues.error}
        </p>
      </div>
    );
  return (
    <ArchivedTasks
      project={project}
      tasks={issues.value.items
        .filter((i) => i.archived_at)
        .sort((a, b) => b.archived_at!.localeCompare(a.archived_at!))
        .map((i) => ({
          key: i.key,
          title: i.title,
          status: i.status,
          archived_at: i.archived_at!,
          runs: i.runs.length,
        }))}
    />
  );
}
