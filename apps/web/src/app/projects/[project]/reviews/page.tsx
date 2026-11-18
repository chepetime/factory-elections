import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PullRequestReviews } from '@/components/pr-reviews';
import { isProjectName } from '@/lib/factory';
import { projectTitle } from '@/lib/page-title';
import { listPullRequests } from '@/lib/reviews';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'PR reviews') : 'PR reviews' };
}
export const dynamic = 'force-dynamic';

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams?: Promise<{ drafts?: string; approved?: string }>;
}) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const query = (await searchParams) ?? {};
  const drafts = query.drafts === '1';
  const approved = query.approved === '1';
  const list = await listPullRequests(project, drafts, approved);
  return (
    <PullRequestReviews
      project={project}
      drafts={drafts}
      approved={approved}
      list={list.ok ? list.value : undefined}
      error={list.ok ? undefined : list.error}
    />
  );
}
