import { ChevronRight, Clock, Cpu, Gauge, Layers } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ISSUE_STATUSES, statusFromStage, type IssueStatus } from '@factory/core';
import { AgentAvatar } from '@/components/agent-avatar';
import {
  ArchiveAgent,
  AssignWork,
  ChatWithAgent,
  EnvironmentForm,
  GeneralForm,
  InstructionsForm,
  SkillsForm,
} from '@/components/agent-editor';
import { LocalTime } from '@/components/local-time';
import { Markdown } from '@/components/markdown';
import { STATUS } from '@/components/task-status';
import { agentModelOptions } from '@/lib/agent-model-options';
import { modelName } from '@/lib/agent-models';
import { AGENT_FACTORY_INSTRUCTIONS, agentStats, type AgentRunLine, type AgentStats } from '@/lib/agents';
import { isProjectName, listProjects } from '@/lib/factory';
import { cn } from '@factory/ui/lib/utils';

export const dynamic = 'force-dynamic';

const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'work', label: 'Work' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'settings', label: 'Settings' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const SECTIONS: Record<'capabilities' | 'settings', { id: string; label: string }[]> = {
  capabilities: [
    { id: 'instructions', label: 'Instructions' },
    { id: 'skills', label: 'Skills' },
    { id: 'tools', label: 'Tools' },
  ],
  settings: [
    { id: 'general', label: 'General' },
    { id: 'environment', label: 'Environment' },
  ],
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!AGENT_ID.test(id)) return { title: 'Agent' };
  const stats = await agentStats(id);
  return { title: stats.ok ? `${stats.value.agent.name} · Agents` : 'Agent' };
}

function duration(from: string, to: string): string {
  const s = Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function RunRow({ run }: { run: AgentRunLine }) {
  const look = STATUS[statusFromStage(run.stage)];
  const href = `/projects/${run.project}/tasks/${run.key ?? run.id}`;
  return (
    <li className="group relative flex items-start gap-3 px-4 py-3 hover:bg-muted/40 has-[a:focus-visible]:bg-muted/40">
      <look.icon className={cn('mt-0.5 size-4 shrink-0', look.tone)} aria-hidden />
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="block truncate text-sm outline-none after:absolute after:inset-0 group-hover:underline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
        >
          {run.key && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{run.key}</span>}
          {run.title}
        </Link>
        <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
          <span className={look.tone}>{look.label}</span>
          <span aria-hidden>·</span>
          <span>{run.project}</span>
          <span aria-hidden>·</span>
          <LocalTime iso={run.updated_at} format="date-time" />
          {run.created_at && (
            <>
              <span aria-hidden>·</span>
              <span>{duration(run.created_at, run.updated_at)}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className="tabular-nums">${run.cost_usd.toFixed(2)}</span>
        </p>
      </div>
    </li>
  );
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b py-4 first:pt-0 last:border-b-0 last:pb-0">
      <h3 className="mb-3 flex items-baseline justify-between gap-3 text-sm font-medium">
        <span>{title}</span>
        {aside !== undefined && (
          <span className="text-sm font-normal text-muted-foreground tabular-nums">{aside}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Overview({ stats }: { stats: AgentStats }) {
  const { agent } = stats;
  const facts: [string, ReactNode][] = [
    ['Model', modelName(agent.model)],
    ['Effort', agent.effort[0]!.toUpperCase() + agent.effort.slice(1)],
    ['Concurrency', agent.concurrency],
    ['Budget per task', `$${agent.task_budget_usd.toFixed(2)}`],
  ];
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-8">
        <section aria-labelledby="now">
          <h2 id="now" className="flex items-baseline gap-2 text-base font-semibold">
            Now
            <span className="text-sm font-normal text-muted-foreground">
              {stats.running.length ? `${stats.running.length} active` : 'No active work'}
            </span>
          </h2>
          {stats.running.length ? (
            <ul className="mt-3 divide-y overflow-hidden rounded-xl border bg-card">
              {stats.running.map((r) => (
                <RunRow key={r.id} run={r} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {agent.name} is not working on anything.{' '}
              {agent.auto_pickup
                ? 'Assign it a Todo task and it starts when it has a free slot.'
                : 'Assign it a task, then move the task to In progress.'}
            </p>
          )}
        </section>
        <section aria-labelledby="recent">
          <h2 id="recent" className="flex items-baseline gap-2 text-base font-semibold">
            Recent work
            {stats.runs.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                {stats.runs.length} latest runs
              </span>
            )}
          </h2>
          {stats.runs.length ? (
            <ul className="mt-3 divide-y overflow-hidden rounded-xl border bg-card">
              {stats.runs.map((r) => (
                <RunRow key={r.id} run={r} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No runs yet.</p>
          )}
        </section>
      </div>
      <aside aria-label="About this agent" className="h-fit rounded-xl border bg-card p-5">
        <Card title="Agent">
          <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 truncate">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Skills" aside={agent.skills.length}>
          {agent.skills.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {agent.skills.map((s) => (
                <li key={s} className="rounded-md border px-2 py-0.5 font-mono text-xs">
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No skills assigned.</p>
          )}
        </Card>
        <Card title="Last 30 days">
          {stats.last30.runs ? (
            <dl className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ['Runs', stats.last30.runs],
                  ['Ready', stats.last30.completed],
                  ['Spent', `$${stats.last30.cost_usd.toFixed(2)}`],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg bg-muted/50 px-2 py-2">
                  <dd className="text-base font-semibold tabular-nums">{value}</dd>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No runs in the last 30 days.</p>
          )}
        </Card>
      </aside>
    </div>
  );
}

function Work({ stats }: { stats: AgentStats }) {
  const groups = ISSUE_STATUSES.map((status) => ({
    status,
    items: stats.work.filter((w) => w.status === status),
  }));
  if (!stats.work.length)
    return (
      <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        No tasks are assigned to {stats.agent.name}. Use Assign work, or pick the agent on a task page.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      {groups.map(({ status, items }) => {
        const look = STATUS[status as IssueStatus];
        return (
          <details
            key={status}
            open={items.length > 0}
            className="group/status overflow-hidden rounded-xl border bg-card"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 bg-muted/40 px-4 py-2.5 text-sm select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden
                className="size-3.5 text-muted-foreground transition-transform group-open/status:rotate-90 motion-reduce:transition-none"
              />
              <look.icon className={cn('size-4', look.tone)} aria-hidden />
              <span className="font-medium">{look.label}</span>
              <span className="text-muted-foreground tabular-nums">{items.length}</span>
            </summary>
            {items.length ? (
              <ul className="divide-y">
                {items.map((w) => (
                  <li
                    key={`${w.project}-${w.key}`}
                    className="group relative flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40"
                  >
                    <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{w.key}</span>
                    <Link
                      href={`/projects/${w.project}/tasks/${w.key}`}
                      className="min-w-0 flex-1 truncate outline-none after:absolute after:inset-0 group-hover:underline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                    >
                      {w.title}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{w.project}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">No tasks.</p>
            )}
          </details>
        );
      })}
    </div>
  );
}

function SectionNav({
  base,
  tab,
  current,
}: {
  base: string;
  tab: 'capabilities' | 'settings';
  current: string;
}) {
  return (
    <nav aria-label={tab === 'capabilities' ? 'Capabilities' : 'Settings'} className="flex gap-1 md:flex-col">
      {SECTIONS[tab].map((s) => (
        <Link
          key={s.id}
          href={`${base}?tab=${tab}&section=${s.id}`}
          aria-current={s.id === current ? 'page' : undefined}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm',
            s.id === current
              ? 'bg-muted font-medium'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

function Pane({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="pane-title" className="flex max-w-3xl flex-col gap-4">
      <div>
        <h2 id="pane-title" className="text-base font-semibold">
          {title}
        </h2>
        {intro && <p className="mt-1 text-sm text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

async function AgentGeneralPane({ agent, archived }: { agent: AgentStats['agent']; archived: boolean }) {
  const models = await agentModelOptions();
  return (
    <Pane title="General">
      <GeneralForm
        key={agent.updated_at}
        id={agent.id}
        models={models}
        initial={{
          name: agent.name,
          avatar: agent.avatar,
          description: agent.description,
          model: agent.model,
          effort: agent.effort,
          concurrency: agent.concurrency,
          task_budget_usd: agent.task_budget_usd,
          auto_pickup: agent.auto_pickup,
        }}
      />
      <ArchiveAgent id={agent.id} name={agent.name} archived={archived} />
    </Pane>
  );
}

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; id: string }>;
  searchParams?: Promise<{ tab?: string; section?: string }>;
}) {
  const { project: current, id } = await params;
  if (!isProjectName(current) || !AGENT_ID.test(id)) notFound();
  const list = `/projects/${current}/agents`;
  const query = (await searchParams) ?? {};
  const tab: Tab = TABS.some((t) => t.id === query.tab) ? (query.tab as Tab) : 'overview';
  const [found, projects] = await Promise.all([agentStats(id), listProjects()]);
  if (!found.ok) {
    if (/not found/i.test(found.error)) notFound();
    return (
      <p role="alert" className="text-destructive">
        Agent unavailable: {found.error}
      </p>
    );
  }
  const stats = found.value;
  const { agent } = stats;
  const base = `${list}/${agent.id}`;
  const working = stats.running.length > 0;
  const archived = Boolean(agent.archived_at);
  const section =
    tab === 'capabilities' || tab === 'settings'
      ? (SECTIONS[tab].find((s) => s.id === query.section) ?? SECTIONS[tab][0]!).id
      : '';
  const projectOptions = projects.ok
    ? projects.value.map((p) => ({ name: p.name, label: p.display_name || p.name }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
        <Link href={list} className="text-muted-foreground hover:text-foreground hover:underline">
          Agents
        </Link>
        <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium">{agent.name}</span>
      </nav>

      <header className="flex flex-wrap items-start gap-5">
        <AgentAvatar agent={agent} size="lg" decorative />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-baseline gap-x-3 text-3xl font-semibold tracking-tight">
            {agent.name}
            <span className="inline-flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
              <span
                aria-hidden
                className={cn('size-2 rounded-full', working ? 'bg-amber-500' : 'bg-muted-foreground/40')}
              />
              {archived ? 'Archived' : working ? 'Working' : 'Idle'}
            </span>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-pretty text-muted-foreground">
            {agent.description || 'No description yet.'}
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li className="inline-flex items-center gap-1.5">
              <Cpu className="size-3.5" aria-hidden /> {modelName(agent.model)}
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Gauge className="size-3.5" aria-hidden /> {agent.effort} effort
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Layers className="size-3.5" aria-hidden /> {agent.concurrency} at a time
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden /> Updated{' '}
              <LocalTime iso={agent.updated_at} format="date-time" />
            </li>
          </ul>
        </div>
        <div className="flex items-start gap-2">
          <ChatWithAgent agent={agent.id} project={current} disabled={archived} />
          <AssignWork agent={agent} projects={projectOptions} disabled={archived} />
        </div>
      </header>

      <nav aria-label="Agent sections" className="-mb-px flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === 'overview' ? base : `${base}?tab=${t.id}`}
            aria-current={t.id === tab ? 'page' : undefined}
            className={cn(
              'border-b-2 px-3 pb-2.5 text-sm whitespace-nowrap',
              t.id === tab
                ? 'border-foreground font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && <Overview stats={stats} />}
      {tab === 'work' && <Work stats={stats} />}
      {(tab === 'capabilities' || tab === 'settings') && (
        <div className="grid gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
          <SectionNav base={base} tab={tab} current={section} />
          <div className="min-w-0">
            {section === 'instructions' && (
              <Pane
                title="Instructions"
                intro="Your notes apply on top of the instructions Factory keeps for every agent. Markdown works."
              >
                <details className="rounded-xl border bg-muted/30 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium select-none">
                    Maintained by Factory{' '}
                    <span className="font-normal text-muted-foreground">
                      · Changes with Factory releases. You cannot edit it, and it never overwrites your notes.
                    </span>
                  </summary>
                  <div className="mt-3 text-sm">
                    <Markdown text={AGENT_FACTORY_INSTRUCTIONS} />
                  </div>
                </details>
                <InstructionsForm key={agent.updated_at} id={agent.id} instructions={agent.instructions} />
              </Pane>
            )}
            {section === 'skills' && (
              <Pane
                title="Skills"
                intro="A skill's SKILL.md is added to this agent's instructions in every task session and chat."
              >
                <SkillsForm
                  key={agent.updated_at}
                  id={agent.id}
                  skills={agent.skills}
                  available={stats.skills_available}
                />
              </Pane>
            )}
            {section === 'tools' && (
              <Pane
                title="Tools"
                intro="What this agent can do in a session. Factory grants these; you cannot widen them here."
              >
                <ul className="flex flex-col divide-y rounded-xl border text-sm">
                  {[
                    [
                      'On a task',
                      'Read, edit and run commands in the task worktree, under the guard and sandbox. Comment on the task, and set it to in progress, in review or blocked. It cannot push or open pull requests.',
                    ],
                    [
                      'In a chat',
                      "Read the chat project's repository, list tasks, and create tasks in Todo. It changes no files and starts no work.",
                    ],
                    ['Outside MCP servers', 'Not available yet. Sessions use only Factory tools.'],
                  ].map(([label, text]) => (
                    <li
                      key={label}
                      className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"
                    >
                      <span className="font-medium">{label}</span>
                      <span className="text-muted-foreground">{text}</span>
                    </li>
                  ))}
                </ul>
              </Pane>
            )}
            {section === 'general' && <AgentGeneralPane agent={agent} archived={archived} />}
            {section === 'environment' && (
              <Pane
                title="Environment"
                intro="Env var names this agent's task sessions may read. Values come from the backend's environment and are never stored. A name is passed only if the backend operator also lists it in FACTORY_AGENT_ENV_ALLOW."
              >
                <EnvironmentForm
                  key={agent.updated_at}
                  id={agent.id}
                  names={agent.pass_env}
                  allowed={stats.env_allowed}
                />
              </Pane>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
