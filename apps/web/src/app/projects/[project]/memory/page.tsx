import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { forgetFactAction, restoreToolsAction } from '@/app/memory-actions';
import { MemoryView } from '@/components/memory-view';
import { isProjectName } from '@/lib/factory';
import { getMemory } from '@/lib/memory';
import { projectTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'Memory') : 'Memory' };
}

/** What the factory has learned about this repository, why, and a way to remove a wrong fact. */
export default async function MemoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const { show } = await searchParams;
  const memory = await getMemory(project);
  return (
    <MemoryView
      project={project}
      snapshot={memory.ok ? memory.value : undefined}
      error={memory.ok ? undefined : memory.error}
      showRemoved={show === 'removed'}
      forget={forgetFactAction}
      restore={restoreToolsAction}
    />
  );
}
