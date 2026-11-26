import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentAvatar } from '@/components/agent-avatar';
import { cell, DataTable, Empty, PageHeader, Unavailable, usd } from '@/components/system-page';
import { modelName } from '@/lib/agent-models';
import { listAgents } from '@/lib/agents';
import { isProjectName } from '@/lib/factory';
import { projectTitle } from '@/lib/page-title';
import { listSpans, modelUsage } from '@/lib/system';
import { userEnvironment } from '@/lib/user-settings';

export const dynamic = 'force-dynamic';
const DAYS = 14;
const CLIS = [
  ['claude', 'Claude Code'],
  ['codex', 'Codex'],
  ['pi', 'Pi'],
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectName(project) ? await projectTitle(project, 'LLMs') : 'LLMs' };
}

const count = new Intl.NumberFormat('en', { notation: 'compact' });

/** The models this project's agents use, the CLIs that run them, and the calls they made here. */
export default async function LlmsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  if (!isProjectName(project)) notFound();
  const [environment, agents, spans] = await Promise.all([
    userEnvironment(),
    listAgents(),
    listSpans('model', 500, { project, days: DAYS }),
  ]);
  const usage = spans.ok ? modelUsage(spans.value.items) : [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="LLMs">
        The models agents use in this project and the CLIs that run them. Which providers and models are
        allowed is a setting for every project, in{' '}
        <Link href="/user/providers" className="underline underline-offset-2">
          Providers and models
        </Link>
        .
      </PageHeader>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Model calls here, {DAYS} days</h2>
        {!spans.ok ? (
          <Unavailable what="Model calls" error={spans.error} />
        ) : usage.length === 0 ? (
          <Empty>No model calls in this project in the last {DAYS} days.</Empty>
        ) : (
          <>
            <DataTable label="Model calls" head={['Model', 'Provider', 'Calls', 'Tokens in / out', 'Cost']}>
              {usage.map((u) => (
                <tr key={`${u.provider}-${u.model}`}>
                  <td className={`${cell} font-mono text-xs`}>{u.model}</td>
                  <td className={cell}>{u.provider}</td>
                  <td className={`${cell} tabular-nums whitespace-nowrap`}>
                    {u.calls}
                    {u.failed > 0 && (
                      <span className="ml-1 text-xs text-destructive">({u.failed} failed)</span>
                    )}
                  </td>
                  <td className={`${cell} tabular-nums whitespace-nowrap`}>
                    {count.format(u.input)} / {count.format(u.output)}
                  </td>
                  <td className={`${cell} tabular-nums`}>{u.cost === null ? 'Not reported' : usd(u.cost)}</td>
                </tr>
              ))}
            </DataTable>
            {spans.value.total > spans.value.items.length && (
              <p className="text-xs text-muted-foreground">
                Counts cover the newest {spans.value.items.length} of {spans.value.total} calls.
              </p>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Agents and their models</h2>
        {!agents.ok ? (
          <Unavailable what="Agents" error={agents.error} />
        ) : (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {agents.value
              .filter((a) => !a.archived_at)
              .map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <AgentAvatar agent={a} decorative />
                  <Link href={`/projects/${project}/agents/${a.id}`} className="font-medium hover:underline">
                    {a.name}
                  </Link>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {modelName(a.model)}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">CLIs on this machine</h2>
        {!environment.ok ? (
          <Unavailable what="CLIs" error={environment.error} />
        ) : (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {CLIS.map(([id, name]) => {
              const cli = environment.value.providers[id];
              return (
                <li key={id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium">{name}</span>
                  <span className="ml-auto text-muted-foreground">
                    {cli.installed
                      ? cli.version
                        ? `Installed, ${cli.version}`
                        : 'Installed'
                      : 'Not installed'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
