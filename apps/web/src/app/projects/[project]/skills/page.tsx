import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Empty, PageHeader, Unavailable } from '@/components/system-page';
import { isProjectName } from '@/lib/factory';
import { projectTitle } from '@/lib/page-title';
import { getSystemCatalog } from '@/lib/system';

export const dynamic = 'force-dynamic';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'Skills') : 'Skills' };
}

/** The skills agents can load in this project: the factory's own, then the repo's. */
export default async function SkillsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const catalog = await getSystemCatalog(project);
  if (!catalog.ok)
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Skills" />
        <Unavailable what="Skills" error={catalog.error} />
      </div>
    );
  const owners = [...new Set(catalog.value.skills.map((s) => s.owner))];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Skills">
        Instructions an agent loads for one kind of work. Factory skills ship with the factory; this
        project&apos;s skills live in its repo, under .claude/skills, .codex/skills or .agents/skills.
      </PageHeader>
      {owners.length === 0 && <Empty>No skills found.</Empty>}
      {owners.map((owner) => (
        <section key={owner} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{owner === 'factory' ? 'Factory' : owner}</h2>
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {catalog.value.skills
              .filter((s) => s.owner === owner)
              .map((s) => (
                <li key={s.path} className="px-4 py-3 text-sm">
                  <p className="font-mono font-medium">
                    {s.name}
                    {s.version && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">v{s.version}</span>
                    )}
                  </p>
                  {s.description && (
                    <p className="mt-1 line-clamp-3 text-muted-foreground">{s.description}</p>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
