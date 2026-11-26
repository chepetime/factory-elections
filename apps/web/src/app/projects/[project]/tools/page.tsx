import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { cell, DataTable, PageHeader, Unavailable } from '@/components/system-page';
import { isProjectName } from '@/lib/factory';
import { projectTitle } from '@/lib/page-title';
import { getSystemCatalog, type SystemCatalog } from '@/lib/system';

export const dynamic = 'force-dynamic';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'Tools') : 'Tools' };
}

function ToolTable({ label, tools, days }: { label: string; tools: SystemCatalog['tools']; days: number }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{label}</h2>
      <DataTable label={label} head={['Tool', 'What it does', 'Who gets it', `Calls here, ${days} days`]}>
        {tools.map((t) => (
          <tr key={t.name}>
            <td className={`${cell} font-mono text-xs whitespace-nowrap`}>{t.name}</td>
            <td className={cell}>{t.description}</td>
            <td className={`${cell} text-muted-foreground`}>{t.when}</td>
            <td className={`${cell} tabular-nums whitespace-nowrap`}>
              {t.calls}
              {t.failed > 0 && <span className="ml-1 text-xs text-destructive">({t.failed} failed)</span>}
            </td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}

/** The tools agents can call, and how often they did in this project. */
export default async function ToolsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const catalog = await getSystemCatalog(project);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Tools">
        Factory tools come from the factory MCP server. Built-in tools come from the provider; the step&apos;s
        access level decides which ones it gets, and the step guard and sandbox check every call.
      </PageHeader>
      {!catalog.ok ? (
        <Unavailable what="Tools" error={catalog.error} />
      ) : (
        <>
          <ToolTable
            label="Factory tools"
            tools={catalog.value.tools.filter((t) => t.source === 'factory')}
            days={catalog.value.usage_days}
          />
          <ToolTable
            label="Built-in tools"
            tools={catalog.value.tools.filter((t) => t.source === 'built-in')}
            days={catalog.value.usage_days}
          />
        </>
      )}
    </div>
  );
}
