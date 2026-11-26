import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PullRequestReviews } from '@/components/pr-reviews';
import { isProjectName } from '@/lib/factory';
import { projectTitle } from '@/lib/page-title';
import { listIssues } from '@/lib/issues';
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
  const [list, issues] = await Promise.all([
    listPullRequests(project, drafts, approved),
    listIssues(project),
  ]);
  const tickets = Object.fromEntries(
    issues.ok ? issues.value.items.flatMap((i) => (i.review ? [[i.review.number, i.key]] : [])) : [],
  );
  return (
    <PullRequestReviews
      project={project}
      drafts={drafts}
      approved={approved}
      tickets={tickets}
      list={list.ok ? list.value : undefined}
      error={list.ok ? undefined : list.error}
    />
  );
}
