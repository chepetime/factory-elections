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
  return { title: isProjectName(project) ? await projectTitle(project, 'MCP') : 'MCP' };
}

/** The MCP servers agent turns can reach. Read-only: the backend sets them per turn. */
export default async function McpPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const catalog = await getSystemCatalog(project);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="MCP">
        The MCP servers agent turns can reach. The factory server runs inside the backend; each turn gets its
        own token and only the tools it may call.
      </PageHeader>
      {!catalog.ok ? (
        <Unavailable what="MCP servers" error={catalog.error} />
      ) : (
        <>
          {catalog.value.mcp.map((server) => (
            <section key={server.name} className="rounded-xl border bg-card px-4 py-3 shadow-xs">
              <h2 className="font-mono text-sm font-medium">{server.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{server.description}</p>
              <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
                <dt className="text-muted-foreground">Transport</dt>
                <dd>{server.transport}</dd>
                <dt className="text-muted-foreground">Tools</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {server.tools.map((t) => (
                    <code key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {t}
                    </code>
                  ))}
                </dd>
              </dl>
            </section>
          ))}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Outside servers</h2>
            {catalog.value.external_mcp.length === 0 ? (
              <Empty>
                No outside MCP servers are set up. Agents reach Jira, Slack and similar services only through
                the factory.
              </Empty>
            ) : (
              <ul className="divide-y rounded-xl border bg-card text-sm">
                {catalog.value.external_mcp.map((s) => (
                  <li key={s.name} className="px-4 py-2">
                    <span className="font-mono">{s.name}</span>{' '}
                    <span className="text-muted-foreground">{s.url}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
