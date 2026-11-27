import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { openBlockers } from '@factory/core';
import { TaskBoard } from '@/components/task-board';
import { isProjectName } from '@/lib/factory';
import { listIssues } from '@/lib/issues';
import { listAgents } from '@/lib/agents';
import { projectTitle } from '@/lib/page-title';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'Tasks') : 'Tasks' };
}
export const dynamic = 'force-dynamic';

export default async function ProjectTasks({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const [issues, agentList] = await Promise.all([listIssues(project), listAgents()]);
  const agents = new Map(
    (agentList.ok ? agentList.value : []).map((a) => [a.id, { name: a.name, avatar: a.avatar }]),
  );
  if (!issues.ok)
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p role="alert" className="mt-2 text-sm text-destructive">
          Tasks unavailable: {issues.error}
        </p>
      </div>
    );
  return (
    <TaskBoard
      project={project}
      now={Date.now()}
      issues={issues.value.items
        .filter((i) => !i.archived_at)
        .map((i) => ({
          key: i.key,
          title: i.title,
          description: i.description,
          status: i.status,
          jira_key: i.jira_key,
          updated_at: i.run?.updated_at && i.run.updated_at > i.updated_at ? i.run.updated_at : i.updated_at,
          run: i.run,
          ...(i.assignee && agents.get(i.assignee) ? { agent: agents.get(i.assignee)! } : {}),
          waits_for: openBlockers(i.blocked_by, issues.value.items),
        }))}
    />
  );
}
