import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { AddProjectForm } from '@/components/add-project-form';
import { Board } from '@/components/board';
import { buildBoard, type BoardInput } from '@/lib/board';
import { loadBoard, loadPulls, projectsWithPulls } from '@/lib/board-data';
import { listProjects } from '@/lib/factory';

export const metadata: Metadata = { title: 'Board' };
export const dynamic = 'force-dynamic';

interface Shared {
  now: number;
  newTaskHref: string;
  showProject: boolean;
  notice?: string;
}

/** The board with PR review state, streamed in after the board without it. */
async function BoardWithPulls({
  input,
  projects,
  ...shared
}: Shared & { input: BoardInput; projects: string[] }) {
  const pulls = await loadPulls(projects);
  const missing = projects.filter((p) => !pulls[p]);
  const notice = [
    shared.notice,
    missing.length ? `PR state unavailable for ${missing.join(', ')}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  return <Board board={buildBoard({ ...input, pulls })} {...shared} notice={notice || undefined} />;
}

/** The board across all projects. Each project's start screen is at /projects/[project]. */
export default async function BoardPage() {
  const projects = await listProjects();
  if (!projects.ok) return <p className="p-6 text-destructive">Projects unavailable: {projects.error}</p>;
  if (projects.value.length === 0)
    return (
      <div className="mx-auto w-full max-w-xl px-6 pt-[16vh]">
        <h1 className="text-2xl font-semibold">No projects yet</h1>
        <p className="mt-2 mb-6 text-muted-foreground">Add a local repository to start.</p>
        <AddProjectForm />
      </div>
    );
  const names = projects.value.map((p) => p.name);
  const remembered = (await cookies()).get('factory.lastProject')?.value;
  const project = names.find((n) => n === remembered) ?? names[0]!;
  const { input, failedProjects, inboxFailed } = await loadBoard(names);
  const notice = [
    failedProjects.length ? `Tasks unavailable for ${failedProjects.join(', ')}` : undefined,
    inboxFailed ? 'Inbox unavailable' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const shared: Shared = {
    now: Date.now(),
    newTaskHref: `/projects/${encodeURIComponent(project)}/tasks/new`,
    showProject: names.length > 1,
    ...(notice ? { notice } : {}),
  };
  const withPulls = projectsWithPulls(input);
  const plain = <Board board={buildBoard(input)} {...shared} />;
  if (withPulls.length === 0) return plain;
  return (
    <Suspense fallback={plain}>
      <BoardWithPulls input={input} projects={withPulls} {...shared} />
    </Suspense>
  );
}
