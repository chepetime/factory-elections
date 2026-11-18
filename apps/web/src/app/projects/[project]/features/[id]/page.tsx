import { FeatureId } from '@factory/core';
import { notFound } from 'next/navigation';
import { FeatureGate } from '@/components/feature-gate';
import { isProjectName } from '@/lib/factory';
import { getFeature } from '@/lib/features';
export const dynamic = 'force-dynamic';
export default async function FeaturePage({ params }: { params: Promise<{ project: string; id: string }> }) {
  const { project, id } = await params;
  if (!isProjectName(project) || !FeatureId.safeParse(id).success) notFound();
  const f = await getFeature(project, id);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{f.title}</h1>
        <p className="text-sm text-muted-foreground">
          {f.stage}
          {f.working ? ` · ${f.working.action} in progress` : ''}
        </p>
      </div>
      {f.error && (
        <p role="alert" className="text-destructive">
          {f.error}
        </p>
      )}
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Specification</h2>
        {f.spec ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{f.spec}</pre>
        ) : (
          <p>No specification yet.</p>
        )}
        {f.critique && (
          <>
            <h3 className="font-medium">Critique</h3>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{f.critique}</pre>
          </>
        )}
        {f.stage === 'spec' && f.spec && !f.working && (
          <FeatureGate project={project} id={id} action="approve-spec" label="Approve specification" />
        )}
        {f.stage === 'spec-approved' && !f.working && (
          <FeatureGate project={project} id={id} action="plan" label="Plan board" />
        )}
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Board</h2>
        {f.tickets.length === 0 ? (
          <p>No tickets planned yet.</p>
        ) : (
          <ul className="space-y-4">
            {f.tickets.map((t) => (
              <li key={t.id} className="border-t pt-3">
                <h3 className="font-medium">
                  {t.id}: {t.title} ({t.size})
                </h3>
                <p className="whitespace-pre-wrap text-sm">{t.description}</p>
                <ul className="list-disc pl-5 text-sm">
                  {t.acceptance.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground">
                  Blocked by: {t.blocked_by.join(', ') || 'none'}
                </p>
              </li>
            ))}
          </ul>
        )}
        {f.stage === 'board' && !f.working && (
          <FeatureGate
            project={project}
            id={id}
            action="approve-board"
            label="Approve board and start work"
          />
        )}
      </section>
    </main>
  );
}
