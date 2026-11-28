import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { parseModelRef } from '@factory/core';
import { ProviderIcon } from '@/components/provider-icon';
import { AgentAvatar } from '@/components/agent-avatar';
import { LocalTime } from '@/components/local-time';
import { NewAgentButton } from '@/components/new-agent-dialog';
import { agentModelOptions } from '@/lib/agent-model-options';
import { modelName } from '@/lib/agent-models';
import { agentStats, listAgents } from '@/lib/agents';
import { isProjectName } from '@/lib/factory';
import { cn } from '@factory/ui/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agents' };

/** The workspace's agents, from inside a project: they are shared by every project. */
export default async function AgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams?: Promise<{ show?: string; q?: string }>;
}) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const base = `/projects/${project}/agents`;
  const { show, q = '' } = (await searchParams) ?? {};
  const archived = show === 'archived';
  const listed = await listAgents();
  if (!listed.ok)
    return (
      <p role="alert" className="text-destructive">
        Agents unavailable: {listed.error}
      </p>
    );
  const all = listed.value;
  const query = q.trim().toLowerCase();
  const shown = all
    .filter((a) => Boolean(a.archived_at) === archived)
    .filter((a) => !query || `${a.name} ${a.description}`.toLowerCase().includes(query));
  const [stats, models] = await Promise.all([
    Promise.all(shown.map((a) => agentStats(a.id))),
    agentModelOptions(),
  ]);
  const counts = {
    all: all.filter((a) => !a.archived_at).length,
    archived: all.filter((a) => a.archived_at).length,
  };
  const chip = (active: boolean) =>
    cn(
      'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm',
      active ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
    );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Teammates that work board tasks in their own session, comment and set status. You approve every
            change before it becomes a pull request. Every project shares the same agents.
          </p>
        </div>
        <NewAgentButton base={base} models={models} />
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <form role="search" className="w-full sm:w-64">
          <label htmlFor="agent-search" className="sr-only">
            Search agents
          </label>
          {archived && <input type="hidden" name="show" value="archived" />}
          <input
            id="agent-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search agents…"
            className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </form>
        <Link href={base} aria-current={!archived ? 'page' : undefined} className={chip(!archived)}>
          All <span className="tabular-nums text-muted-foreground">{counts.all}</span>
        </Link>
        <Link
          href={`${base}?show=archived`}
          aria-current={archived ? 'page' : undefined}
          className={chip(archived)}
        >
          Archived <span className="tabular-nums text-muted-foreground">{counts.archived}</span>
        </Link>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {query
            ? 'No agent matches that search.'
            : archived
              ? 'No archived agents.'
              : 'No agents yet. Create one to start.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Agent
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Model
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Last active
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Runs, 30 days
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((agent, i) => {
                const s = stats[i]!.ok ? stats[i]!.value : undefined;
                const working = (s?.running.length ?? 0) > 0;
                const last = s?.runs[0]?.updated_at;
                return (
                  <tr
                    key={agent.id}
                    className="group relative hover:bg-muted/40 has-[a:focus-visible]:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <AgentAvatar agent={agent} decorative />
                        <div className="min-w-0">
                          <Link
                            href={`${base}/${agent.id}`}
                            className="font-medium outline-none after:absolute after:inset-0 group-hover:underline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                          >
                            {agent.name}
                          </Link>
                          <p className="max-w-md truncate text-xs text-muted-foreground">
                            {agent.description || 'No description'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={cn(
                            'size-2 rounded-full',
                            working ? 'bg-amber-500' : 'bg-muted-foreground/40',
                          )}
                        />
                        {agent.archived_at ? 'Archived' : working ? 'Working' : 'Idle'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <ProviderIcon provider={parseModelRef(agent.model).provider} model={agent.model} />
                        {modelName(agent.model)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {last ? <LocalTime iso={last} format="date-time" /> : 'Not yet'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{s?.last30.runs ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
