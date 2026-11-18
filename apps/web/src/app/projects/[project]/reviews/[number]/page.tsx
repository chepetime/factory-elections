import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ReviewChat } from '@/components/review-chat';
import { isProjectName } from '@/lib/factory';
import { clip, projectLabel, reviewGlyph } from '@/lib/page-title';
import { reviewDetail } from '@/lib/reviews';

const valid = (project: string, number: string) => isProjectName(project) && /^\d{1,10}$/.test(number);
/** One backend read per request, shared by the tab title and the page. */
const load = cache((project: string, number: number) => reviewDetail(project, number));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; number: string }>;
}): Promise<Metadata> {
  const { project, number } = await params;
  if (!valid(project, number)) return { title: 'PR review' };
  const [detail, label] = await Promise.all([load(project, Number(number)), projectLabel(project)]);
  if (!detail.ok) return { title: `#${number} · ${label}` };
  const name = detail.value.title || detail.value.payload?.meta.pr_title;
  return {
    title: `${reviewGlyph(detail.value.state)} #${number}${name ? ` ${clip(name, 40)}` : ''} · ${label}`,
  };
}
export const dynamic = 'force-dynamic';

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ project: string; number: string }>;
}) {
  const { project, number } = await params;
  if (!valid(project, number)) notFound();
  const detail = await load(project, Number(number));
  if (!detail.ok) return <p className="p-6 text-destructive">Review unavailable: {detail.error}</p>;
  const title =
    detail.value.title || detail.value.payload?.meta.pr_title || detail.value.branch || `PR #${number}`;
  return <ReviewChat project={project} title={title} initial={detail.value} />;
}
