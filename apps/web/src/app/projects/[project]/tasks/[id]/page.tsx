import { Check, ChevronRight, GitPullRequest, Minus, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  stageLabel,
  statusFromStage,
  taskAccess,
  issueCreator,
  type IssueStatus,
  type ServiceAccess,
  type TaskRecord,
  queueWaitLabel,
} from '@factory/core';
import { FollowUpForm } from '@/components/follow-up-form';
import { LocalTime } from '@/components/local-time';
import { Markdown } from '@/components/markdown';
import {
  IssueArchivedBanner,
  IssueAssigneeField,
  IssueCommentBox,
  IssueDateField,
  IssueDescription,
  IssuePriorityField,
  IssueReplyBox,
  IssueStatusField,
  IssueTitle,
} from '@/components/issue-editor';
import { StageBadge } from '@/components/stage-badge';
import { STATUS, StatusLabel } from '@/components/task-status';
import { Fact, Facts, money, renderRun, Section } from '@/components/task-run';
import { isProjectName, isTaskId, showTask } from '@/lib/factory';
import { getIssue, type IssueView } from '@/lib/issues';
import { listAgents } from '@/lib/agents';
import { ResizablePane } from '@/components/resizable-pane';
import { RunSessionView } from '@/components/run-session';
import { readRunSession } from '@/lib/run-session';
import { TASK_DETAILS_PANE } from '@/lib/pane-spec';
import { modelTotals, ticketTimeline } from '@/lib/ticket-timeline';
import { TicketTimeline } from '@/components/ticket-timeline';
import { paneWidth } from '@/lib/pane-width';
import { AgentAvatar } from '@/components/agent-avatar';
import { clip, projectLabel } from '@/lib/page-title';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TASK_KEY = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,9}$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; id: string }>;
}): Promise<Metadata> {
  const { project, id } = await params;
  if (!isProjectName(project) || !TASK_KEY.test(id)) return { title: 'Task' };
  const [issue, label] = await Promise.all([getIssue(project, id), projectLabel(project)]);
  return { title: issue.ok ? `${issue.value.key} ${clip(issue.value.title)} · ${label}` : `Task · ${label}` };
}

type IssueEvent = IssueView['events'][number];
type IssueComment = IssueView['comments'][number];
type FeedItem =
  | { at: string; kind: 'event'; event: IssueEvent }
  | { at: string; kind: 'thread'; root: IssueComment; replies: IssueComment[] };

/** Status changes show the new status icon; older events only carry it in their kind. */
function eventStatus(event: IssueEvent): IssueStatus | undefined {
  const to = event.to ?? (event.kind.startsWith('move:') ? event.kind.slice(5) : undefined);
  return to && to in STATUS ? (to as IssueStatus) : undefined;
}

function Happening({ event }: { event: IssueEvent }) {
  const status = eventStatus(event);
  const look = status ? STATUS[status] : undefined;
  return (
    <li className="flex items-center gap-2.5 py-1.5 text-sm text-muted-foreground">
      {look ? (
        <look.icon className={cn('size-4 shrink-0', look.tone)} aria-hidden />
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        </span>
      )}
      <span className="min-w-0 flex-1">{event.message}</span>
      <LocalTime iso={event.at} format="date-time" className="shrink-0 text-xs tabular-nums" />
    </li>
  );
}

/** Two or more events in a row fold under one "N activities" line. */
function Happenings({ events }: { events: IssueEvent[] }) {
  const rows = events.map((e, i) => <Happening key={`${e.at}-${e.kind}-${i}`} event={e} />);
  if (events.length === 1) return <ol>{rows}</ol>;
  return (
    <details open className="group/acts">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-md py-1 text-sm text-muted-foreground select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform duration-150 ease-out group-open/acts:rotate-90 motion-reduce:transition-none"
        />
        {events.length} activities
      </summary>
      <ol>{rows}</ol>
    </details>
  );
}

type Authors = Record<string, { name: string; avatar: string }>;

function CommentBody({
  comment,
  reply,
  authors,
}: {
  comment: IssueComment;
  reply?: boolean;
  authors: Authors;
}) {
  const agent =
    comment.author === 'you'
      ? undefined
      : (authors[comment.author] ?? { name: comment.author, avatar: '🤖' });
  return (
    <div className={cn('px-4 py-3', reply && 'border-t')}>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {agent && <AgentAvatar agent={agent} size="sm" decorative />}
        <span className="text-sm font-medium text-foreground">{agent?.name ?? 'You'}</span>
        <LocalTime iso={comment.at} format="date-time" />
      </p>
      <div className="mt-1.5 text-sm">
        <Markdown text={comment.body} />
      </div>
    </div>
  );
}

function Thread({
  project,
  issueKey,
  root,
  replies,
  authors,
}: {
  project: string;
  issueKey: string;
  root: IssueComment;
  replies: IssueComment[];
  authors: Authors;
}) {
  return (
    <article
      aria-label={`Comment thread, ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
      className="overflow-hidden rounded-xl border bg-card shadow-xs"
    >
      <CommentBody comment={root} authors={authors} />
      {replies.map((r) => (
        <CommentBody key={r.id} comment={r} reply authors={authors} />
      ))}
      <IssueReplyBox project={project} issueKey={issueKey} parent={root.id} />
    </article>
  );
}

const ACCESS_LOOK = {
  full: { icon: Check, tone: 'text-emerald-600 dark:text-emerald-400', label: 'Full access' },
  limited: { icon: Minus, tone: 'text-amber-600 dark:text-amber-400', label: 'Limited access' },
  none: { icon: X, tone: 'text-muted-foreground', label: 'No access' },
} as const;

/** Which services the task's session can reach. Services with no access share one line. */
function AccessList({ access }: { access: ServiceAccess[] }) {
  const reachable = access.filter((a) => a.level !== 'none' || a.service === 'GitHub');
  const off = access.filter((a) => a.level === 'none' && a.service !== 'GitHub');
  return (
    <ul className="flex flex-col gap-2.5 text-sm">
      {reachable.map((a) => {
        const look = ACCESS_LOOK[a.level];
        return (
          <li key={a.service} className="flex gap-2">
            <look.icon className={cn('mt-0.5 size-4 shrink-0', look.tone)} aria-label={look.label} />
            <span className="min-w-0">
              <span className="font-medium">{a.service}</span>
              <span className="block text-xs text-muted-foreground">{a.detail}</span>
            </span>
          </li>
        );
      })}
      {off.length > 0 && (
        <li className="flex gap-2">
          <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="No access" />
          <span className="min-w-0">
            <span className="font-medium">Not connected</span>
            <span className="block text-xs text-muted-foreground">
              {off.map((a) => a.service).join(', ')}
            </span>
          </span>
        </li>
      )}
    </ul>
  );
}

/** Issue events and comment threads, oldest first. A thread sorts by its first comment. */
function feedItems(issue: IssueView): FeedItem[] {
  const roots = issue.comments.filter((c) => !c.parent || !issue.comments.some((r) => r.id === c.parent));
  return [
    ...issue.events.map((event): FeedItem => ({ at: event.at, kind: 'event', event })),
    ...roots.map((root): FeedItem => ({
      at: root.at,
      kind: 'thread',
      root,
      replies: issue.comments.filter((c) => c.parent === root.id),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

function Feed({
  items,
  project,
  issueKey,
  authors,
}: {
  items: FeedItem[];
  project: string;
  issueKey: string;
  authors: Authors;
}) {
  const blocks: ReactNode[] = [];
  let events: IssueEvent[] = [];
  const flush = () => {
    if (events.length) blocks.push(<Happenings key={`acts-${blocks.length}`} events={events} />);
    events = [];
  };
  for (const item of items) {
    if (item.kind === 'event') {
      events.push(item.event);
      continue;
    }
    flush();
    blocks.push(
      <Thread
        key={item.root.id}
        project={project}
        issueKey={issueKey}
        root={item.root}
        replies={item.replies}
        authors={authors}
      />,
    );
  }
  flush();
  return blocks.length ? <div className="mt-3 flex flex-col gap-3">{blocks}</div> : null;
}

/** `https://github.com/o/r/pull/12` reads `o/r#12`; any other URL stays as it is. */
function prLabel(url: string): string {
  const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return m ? `${m[1]}#${m[2]}` : url;
}

/** Known spend across runs; a run with an unpriced attempt marks the total as partial. */
function totalCost(records: TaskRecord[]): string | undefined {
  const attempts = records.flatMap((r) => r.attempts ?? []);
  if (!attempts.length) return undefined;
  const sum = attempts.reduce((total, a) => total + (a.cost_usd ?? 0), 0);
  return `${attempts.some((a) => a.cost_usd === null) ? 'at least ' : ''}$${sum.toFixed(2)}`;
}

function RunRow({
  href,
  index,
  record,
  current,
  latest,
}: {
  href: string;
  index: number;
  record: TaskRecord | undefined;
  current: boolean;
  latest: boolean;
}) {
  const look = record ? STATUS[statusFromStage(record.stage)] : undefined;
  const Icon = look?.icon;
  return (
    <li>
      <Link
        href={href}
        aria-current={current ? 'true' : undefined}
        className={cn(
          '-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted',
          current && 'bg-muted',
        )}
      >
        {Icon ? (
          <Icon className={cn('size-4 shrink-0', look.tone)} aria-hidden />
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <span className={cn('shrink-0', current && 'font-medium')}>Run {index}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {record ? stageLabel(record.stage) : 'Unavailable'}
          {latest && ' · latest'}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{record ? money(record) : ''}</span>
      </Link>
    </li>
  );
}

type SummaryAgent = { id: string; name: string; avatar: string; archived: boolean };

/** One labeled value in the summary row under the title. */
function SummaryItem({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex min-h-7 items-center text-sm">{children}</div>
    </div>
  );
}

function Creator({ creator, agents }: { creator?: string; agents: SummaryAgent[] }) {
  if (!creator) return <span className="text-muted-foreground">Not recorded</span>;
  if (creator === 'you') return <span>You</span>;
  if (creator === 'factory') return <span>Factory</span>;
  const agent = agents.find((a) => a.id === creator);
  if (!agent) return <span>{creator}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <AgentAvatar agent={agent} size="sm" decorative />
      {agent.name}
    </span>
  );
}

/** What the task is and who has it: status, priority, agent, creator, and its planning dates. */
function TaskSummary({
  project,
  issue,
  agents,
  feature,
}: {
  project: string;
  issue: IssueView;
  agents: SummaryAgent[];
  feature?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !!issue.due_date && issue.due_date < today && issue.status !== 'done';
  return (
    <div
      aria-label="Summary"
      role="group"
      className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-card px-4 py-3 shadow-xs sm:grid-cols-4"
    >
      <SummaryItem label="Status">
        <IssueStatusField
          project={project}
          issue={{ key: issue.key, title: issue.title, status: issue.status, run: issue.run }}
        />
      </SummaryItem>
      <SummaryItem label="Priority" htmlFor="issue-priority">
        <IssuePriorityField
          project={project}
          issueKey={issue.key}
          priority={issue.priority}
          id="issue-priority"
          className="mx-0 -ml-1.5"
        />
      </SummaryItem>
      <SummaryItem label="Agent" htmlFor="issue-assignee">
        <IssueAssigneeField
          project={project}
          issueKey={issue.key}
          {...(issue.assignee ? { assignee: issue.assignee } : {})}
          agents={agents}
          id="issue-assignee"
          className="mx-0 -ml-1.5"
        />
      </SummaryItem>
      <SummaryItem label="Created by">
        <Creator creator={issueCreator(issue)} agents={agents} />
      </SummaryItem>
      <SummaryItem label="Start date" htmlFor="issue-start-date">
        <IssueDateField
          project={project}
          issueKey={issue.key}
          field="start_date"
          id="issue-start-date"
          {...(issue.start_date ? { value: issue.start_date } : {})}
        />
      </SummaryItem>
      <SummaryItem label={overdue ? 'Due date (late)' : 'Due date'} htmlFor="issue-due-date">
        <IssueDateField
          project={project}
          issueKey={issue.key}
          field="due_date"
          id="issue-due-date"
          overdue={overdue}
          {...(issue.due_date ? { value: issue.due_date } : {})}
        />
      </SummaryItem>
      <SummaryItem label="Feature">
        {feature ? (
          <Link
            href={`/projects/${project}/features/${encodeURIComponent(feature)}`}
            className="truncate underline-offset-2 hover:underline"
          >
            {feature}
          </Link>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </SummaryItem>
      {issue.jira_key && (
        <SummaryItem label="Jira">
          <span className="font-mono text-xs">{issue.jira_key}</span>
        </SummaryItem>
      )}
    </div>
  );
}

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; id: string }>;
  searchParams?: Promise<{ start?: string; run?: string; panel?: string; followup?: string }>;
}) {
  const query = (await searchParams) ?? {};
  const { project, id } = await params;
  if (!isProjectName(project)) notFound();

  // A run id (from the inbox, the home composer or an old link) opens the task that owns the run.
  if (isTaskId(id)) {
    const owner = await getIssue(project, id);
    if (!owner.ok) notFound();
    const next = new URLSearchParams();
    if (query.start) next.set('start', query.start);
    if (owner.value.run?.id !== id) next.set('run', id);
    redirect(`/projects/${project}/tasks/${owner.value.key}${next.size ? `?${next}` : ''}`);
  }
  if (!TASK_KEY.test(id)) notFound();
  const found = await getIssue(project, id);
  if (!found.ok) {
    if (/not found/i.test(found.error)) notFound();
    return (
      <div className="px-6 py-6">
        <p role="alert" className="text-destructive">
          Task unavailable: {found.error}
        </p>
      </div>
    );
  }
  const issue = found.value;
  if (issue.key !== id) redirect(`/projects/${project}/tasks/${issue.key}`);

  const runId = query.run && issue.runs.includes(query.run) ? query.run : issue.run?.id;
  const comment = <IssueCommentBox project={project} issueKey={issue.key} />;
  const roster = await listAgents();
  const assigned =
    roster.ok && issue.assignee ? roster.value.find((a) => a.id === issue.assignee) : undefined;
  // In the Run tab the same box replies to the waiting agent: a comment there wakes its session.
  const reply = assigned ? (
    <IssueCommentBox project={project} issueKey={issue.key} placeholder={`Reply to ${assigned.name}…`} />
  ) : (
    comment
  );
  const run = runId
    ? await renderRun(project, runId, {
        startFailed: query.start === 'failed',
        fallback: reply,
        runHref: `/projects/${project}/tasks/${issue.key}?panel=run${query.run ? `&run=${query.run}` : ''}`,
      })
    : undefined;
  const runStart = runId && run?.ok ? (run.value.task.created_at ?? '') : undefined;
  const feed = feedItems(issue);
  const before = runStart === undefined ? feed : feed.filter((h) => h.at < runStart);
  const after = runStart === undefined ? [] : feed.filter((h) => h.at >= runStart);
  const runIndex = runId ? issue.runs.indexOf(runId) + 1 : 0;
  // The right panel shows the run when there is one; Details holds properties and run details.
  const panel: 'run' | 'details' =
    query.panel === 'details' || (!runId && query.panel !== 'run') ? 'details' : 'run';
  const panelHref = (p: 'run' | 'details') =>
    `/projects/${project}/tasks/${issue.key}?panel=${p}${query.run ? `&run=${query.run}` : ''}`;
  const session = runId && panel === 'run' ? await readRunSession(project, runId) : undefined;
  const [agentList, detailsWidth, ...loaded] = await Promise.all([
    Promise.resolve(roster),
    paneWidth(TASK_DETAILS_PANE),
    ...issue.runs.map((rid) =>
      rid === runId && run?.ok
        ? Promise.resolve(run.value.task)
        : showTask(project, rid).then((r) => (r.ok ? r.value : undefined)),
    ),
  ]);
  const records = loaded as (TaskRecord | undefined)[];
  const agents = agentList.ok ? agentList.value : [];
  const authors: Authors = Object.fromEntries(agents.map((a) => [a.id, { name: a.name, avatar: a.avatar }]));
  // The latest run decides who works the task; with no run yet, the assigned agent would.
  const runRecord = run?.ok ? run.value.task : undefined;
  const runAgentId = runRecord
    ? runRecord.workflow === 'agent'
      ? runRecord.agent
      : undefined
    : issue.assignee;
  const runAgent = runAgentId ? agents.find((x) => x.id === runAgentId) : undefined;
  const runAuthor = runAgent ? { name: runAgent.name, avatar: runAgent.avatar } : undefined;
  const runHref = (rid: string) =>
    `/projects/${project}/tasks/${issue.key}${rid === issue.run?.id ? '' : `?run=${rid}`}`;
  const pulls = records.flatMap((r) => (r?.pr ? [r.pr] : [])).reverse();
  const cost = totalCost(records.filter((r): r is TaskRecord => !!r));
  const rows = issue.runs.map((rid, i) => ({ rid, index: i + 1, record: records[i] })).reverse();
  const [latestRow, ...pastRows] = rows;
  const creator = issueCreator(issue);
  const agentName = (id?: string) => (id ? (agents.find((a) => a.id === id)?.name ?? id) : undefined);
  const timeline = ticketTimeline(issue, records, {
    ...(creator
      ? { creator: creator === 'you' ? 'you' : creator === 'factory' ? 'the factory' : agentName(creator)! }
      : {}),
    agent: agentName,
  });

  return (
    <div className="flex h-full min-h-0 flex-col max-lg:overflow-y-auto lg:flex-row">
      <section
        aria-label="Task"
        className="flex min-h-0 flex-col max-lg:min-h-[85dvh] max-lg:shrink-0 lg:min-w-0 lg:flex-1"
      >
        <nav
          aria-label="Breadcrumb"
          className="flex shrink-0 items-center gap-1.5 border-b px-6 py-3 text-sm"
        >
          <Link
            href={`/projects/${project}/tasks`}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            Tasks
          </Link>
          <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-mono text-xs text-muted-foreground">{issue.key}</span>
          <span className="min-w-0 truncate font-medium">{issue.title}</span>
        </nav>
        {issue.archived_at && <IssueArchivedBanner project={project} issueKey={issue.key} />}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <IssueTitle project={project} issueKey={issue.key} title={issue.title} />
            <TaskSummary
              project={project}
              issue={issue}
              agents={agents.map((a) => ({
                id: a.id,
                name: a.name,
                avatar: a.avatar,
                archived: Boolean(a.archived_at),
              }))}
              feature={runRecord?.ticket?.feature}
            />
            <div className="mt-4">
              <IssueDescription project={project} issueKey={issue.key} description={issue.description} />
            </div>

            <h2 className="mt-10 border-t pt-6 text-base font-semibold">Activity</h2>
            <Feed items={before} project={project} issueKey={issue.key} authors={authors} />

            {runId && run && !run.ok && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                Run unavailable: {run.error}
              </p>
            )}
            {run?.ok && (
              <div className="mt-4 flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs">
                {runAuthor ? (
                  <AgentAvatar agent={runAuthor} decorative />
                ) : (
                  <StatusLabel status={statusFromStage(run.value.task.stage)} className="text-sm" />
                )}
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">Run {runIndex}</span>
                  {runAuthor && <span className="text-muted-foreground"> · {runAuthor.name}</span>}
                  <span className="text-muted-foreground">
                    {' · '}
                    {/* Only the latest run can have a queued turn; an older run shows its own stage. */}
                    {issue.run?.waiting && runId === issue.run.id
                      ? queueWaitLabel(issue.run.waiting_for, runAuthor?.name)
                      : stageLabel(run.value.task.stage)}
                  </span>
                </p>
                {run.value.task.pr && (
                  <a
                    href={run.value.task.pr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <GitPullRequest className="size-4 text-muted-foreground" aria-hidden />
                    {prLabel(run.value.task.pr.url)}
                  </a>
                )}
                {panel !== 'run' && (
                  <Link
                    href={panelHref('run')}
                    className="shrink-0 rounded-lg border px-2.5 py-1 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Open
                  </Link>
                )}
              </div>
            )}
            <Feed items={after} project={project} issueKey={issue.key} authors={authors} />
            {/* What the latest run needs from you comes last, after the newest activity. */}
            {run?.ok && runId === issue.run?.id && run.value.attention && (
              <div className="mt-3">{run.value.attention}</div>
            )}
            {/* The latest run's PR is open: more work is a follow-up on the same branch and PR. It is
                hidden while a follow-up waits or works: one at a time. */}
            {run?.ok &&
              runId === issue.run?.id &&
              run.value.task.stage === 'pr-opened' &&
              !issue.run?.waiting &&
              !issue.run?.owned && (
                <FollowUpForm
                  project={project}
                  issueKey={issue.key}
                  agents={agents.filter((a) => !a.archived_at).map((a) => ({ id: a.id, name: a.name }))}
                  {...(((run.value.task.workflow === 'agent' ? run.value.task.agent : undefined) ??
                  issue.assignee)
                    ? {
                        defaultAgent:
                          (run.value.task.workflow === 'agent' ? run.value.task.agent : undefined) ??
                          issue.assignee!,
                      }
                    : {})}
                  base={run.value.task.worktree?.base_branch ?? 'main'}
                  open={query.followup === '1'}
                />
              )}
          </div>
        </div>

        {comment}
      </section>

      <ResizablePane
        spec={TASK_DETAILS_PANE}
        initialWidth={detailsWidth}
        edge="left"
        label="Task details"
        className="min-h-0 border-t bg-muted/30 lg:flex lg:flex-col lg:border-t-0 lg:border-l"
      >
        <nav aria-label="Panel" className="flex shrink-0 gap-1 border-b bg-muted/80 px-3 pt-2">
          {(
            [
              ['run', 'Run'],
              ['details', 'Details'],
            ] as const
          ).map(([id, label]) => (
            <Link
              key={id}
              href={panelHref(id)}
              aria-current={panel === id ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 px-3 pb-2 text-sm',
                panel === id
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        {panel === 'run' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {!run ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No run yet.{' '}
                {runAgent
                  ? `${runAgent.name} starts when the task is in Todo.`
                  : 'Move the task to In progress to start one.'}
              </p>
            ) : !run.ok ? (
              <p role="alert" className="px-5 py-6 text-sm text-destructive">
                Run unavailable: {run.error}
              </p>
            ) : (
              <>
                <div className="flex shrink-0 items-center gap-2 px-5 pt-4 text-sm">
                  <span className="font-medium">Run {runIndex}</span>
                  <StageBadge stage={run.value.task.stage} />
                  {runId !== issue.run?.id && (
                    <Link
                      href={`/projects/${project}/tasks/${issue.key}?panel=run`}
                      className="ml-auto text-xs text-muted-foreground hover:underline"
                    >
                      Show the latest run
                    </Link>
                  )}
                </div>
                <div data-run-scroll className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {session?.ok ? (
                    <RunSessionView
                      project={project}
                      runId={runId!}
                      initial={session.value}
                      author={runAuthor ?? { name: 'Factory', avatar: '🏭' }}
                    />
                  ) : (
                    session && (
                      <p role="alert" className="text-sm text-destructive">
                        Session unavailable: {session.error}
                      </p>
                    )
                  )}
                  <h3 className="mt-6 mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Status and actions
                  </h3>
                  <div className="flex flex-col gap-5">{run.value.activity}</div>
                </div>
                <div className="shrink-0 border-t bg-muted/80 pt-3">{run.value.composer}</div>
              </>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 lg:overflow-y-auto">
            <Section title="Access" aside={runAgent?.name ?? 'Pipeline'}>
              <AccessList
                access={taskAccess({
                  workflow: runAgent ? 'agent' : 'pipeline',
                  ...(issue.jira_key ? { jiraKey: issue.jira_key } : {}),
                })}
              />
            </Section>

            <Section title="Pull requests">
              {pulls.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {pulls.map((pr) => (
                    <li key={pr.url} className="flex items-start gap-2">
                      <GitPullRequest className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0">
                        <a
                          href={pr.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {prLabel(pr.url)}
                        </a>
                        <span
                          className="block truncate font-mono text-xs text-muted-foreground"
                          title={pr.branch}
                        >
                          {pr.branch} · {pr.head_sha.slice(0, 12)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No pull request yet. A run opens one after you approve its change.
                </p>
              )}
            </Section>

            <Section
              title="Timeline"
              aside={`${timeline.length} ${timeline.length === 1 ? 'event' : 'events'}`}
            >
              <TicketTimeline entries={timeline} models={modelTotals(records)} />
            </Section>

            <Section title="Execution log" aside={cost && <span className="tabular-nums">{cost}</span>}>
              {latestRow ? (
                <ol className="flex flex-col">
                  <RunRow
                    href={runHref(latestRow.rid)}
                    index={latestRow.index}
                    record={latestRow.record}
                    current={latestRow.rid === runId}
                    latest={pastRows.length > 0}
                  />
                  {pastRows.length > 0 && (
                    <li>
                      <details open={pastRows.some((r) => r.rid === runId)} className="group/past">
                        <summary className="-mx-2 flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                          <ChevronRight
                            aria-hidden
                            className="size-3.5 transition-transform duration-150 ease-out group-open/past:rotate-90 motion-reduce:transition-none"
                          />
                          Past runs ({pastRows.length})
                        </summary>
                        <ol className="flex flex-col">
                          {pastRows.map((r) => (
                            <RunRow
                              key={r.rid}
                              href={runHref(r.rid)}
                              index={r.index}
                              record={r.record}
                              current={r.rid === runId}
                              latest={false}
                            />
                          ))}
                        </ol>
                      </details>
                    </li>
                  )}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No runs yet. Move the task to In progress to start one.
                </p>
              )}
            </Section>

            <Section title="Details">
              <Facts>
                <Fact label="Created">
                  <LocalTime iso={issue.created_at} format="date-time" />
                </Fact>
                <Fact label="Updated">
                  <LocalTime iso={issue.updated_at} format="date-time" />
                </Fact>
              </Facts>
            </Section>

            {run?.ok && run.value.sections}
          </div>
        )}
      </ResizablePane>
    </div>
  );
}
