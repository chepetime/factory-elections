import { FEATURE_STAGE_LABELS } from '@factory/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isProjectName } from '@/lib/factory';
import { listFeatures } from '@/lib/features';
export const dynamic = 'force-dynamic';
export default async function FeaturesPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const features = await listFeatures(project);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Features</h1>
      {features.length === 0 ? (
        <p>No features yet.</p>
      ) : (
        <ul className="space-y-3">
          {features.map((f) => (
            <li key={f.id} className="rounded-xl border p-4">
              <Link className="font-medium underline" href={`/projects/${project}/features/${f.id}`}>
                {f.title}
              </Link>
              <p className="text-sm text-muted-foreground">
                {FEATURE_STAGE_LABELS[f.stage]} · {f.tickets} tickets
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
