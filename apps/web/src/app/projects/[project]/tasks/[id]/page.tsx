import { ChevronRight, Folder, GitPullRequest } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { statusFromStage, type IssueStatus, type Stage, type TaskRecord } from '@factory/core';
import { LocalTime } from '@/components/local-time';
import { Markdown } from '@/components/markdown';
import {
  IssueArchivedBanner,
  IssueAssigneeField,
  IssueCommentBox,
  IssueDescription,
  IssuePriorityField,
  IssueReplyBox,
  IssueStatusField,
  IssueTitle,
} from '@/components/issue-editor';
import { StageBadge } from '@/components/stage-badge';
import { STATUS } from '@/components/task-status';
import { Fact, Facts, money, renderRun, Section } from '@/components/task-run';
import { isProjectName, isTaskId, showTask } from '@/lib/factory';
import { getIssue, type IssueView } from '@/lib/issues';
import { listAgents } from '@/lib/agents';
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

const stageLabel = (stage: Stage) => stage.charAt(0).toUpperCase() + stage.slice(1).replace(/-/g, ' ');

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

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; id: string }>;
  searchParams?: Promise<{ start?: string; run?: string }>;
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
  const run = runId
    ? await renderRun(project, runId, { startFailed: query.start === 'failed', fallback: comment })
    : undefined;
  const runStart = runId && run?.ok ? (run.value.task.created_at ?? '') : undefined;
  const feed = feedItems(issue);
  const before = runStart === undefined ? feed : feed.filter((h) => h.at < runStart);
  const after = runStart === undefined ? [] : feed.filter((h) => h.at >= runStart);
  const runIndex = runId ? issue.runs.indexOf(runId) + 1 : 0;
  const [label, agentList, ...loaded] = await Promise.all([
    projectLabel(project),
    listAgents(),
    ...issue.runs.map((rid) =>
      rid === runId && run?.ok
        ? Promise.resolve(run.value.task)
        : showTask(project, rid).then((r) => (r.ok ? r.value : undefined)),
    ),
  ]);
  const records = loaded as (TaskRecord | undefined)[];
  const agents = agentList.ok ? agentList.value : [];
  const authors: Authors = Object.fromEntries(agents.map((a) => [a.id, { name: a.name, avatar: a.avatar }]));
  const runHref = (rid: string) =>
    `/projects/${project}/tasks/${issue.key}${rid === issue.run?.id ? '' : `?run=${rid}`}`;
  const pulls = records.flatMap((r) => (r?.pr ? [r.pr] : [])).reverse();
  const cost = totalCost(records.filter((r): r is TaskRecord => !!r));
  const rows = issue.runs.map((rid, i) => ({ rid, index: i + 1, record: records[i] })).reverse();
  const [latestRow, ...pastRows] = rows;

  return (
    <div className="flex h-full min-h-0 flex-col max-lg:overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label="Task" className="flex min-h-0 flex-col max-lg:min-h-[85dvh] max-lg:shrink-0">
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
              <div className="mt-4 rounded-2xl border bg-muted/30 p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                  Run {runIndex}
                  <StageBadge stage={run.value.task.stage} />
                  {runId !== issue.run?.id && (
                    <Link
                      href={`/projects/${project}/tasks/${issue.key}`}
                      className="ml-auto text-xs font-normal text-muted-foreground hover:underline"
                    >
                      Show the latest run
                    </Link>
                  )}
                </p>
                <div className="flex flex-col gap-5">{run.value.activity}</div>
              </div>
            )}
            <Feed items={after} project={project} issueKey={issue.key} authors={authors} />
          </div>
        </div>

        {run?.ok ? run.value.composer : comment}
      </section>

      <aside
        aria-label="Task details"
        className="min-h-0 border-t bg-muted/30 lg:overflow-y-auto lg:border-t-0 lg:border-l"
      >
        <Section title="Properties">
          <Facts>
            <Fact label="Status">
              <IssueStatusField
                project={project}
                issue={{ key: issue.key, title: issue.title, status: issue.status, run: issue.run }}
              />
            </Fact>
            <Fact label="Agent">
              <IssueAssigneeField
                project={project}
                issueKey={issue.key}
                {...(issue.assignee ? { assignee: issue.assignee } : {})}
                agents={agents.map((a) => ({
                  id: a.id,
                  name: a.name,
                  avatar: a.avatar,
                  archived: Boolean(a.archived_at),
                }))}
                id="issue-assignee"
              />
            </Fact>
            <Fact label="Priority">
              <IssuePriorityField
                project={project}
                issueKey={issue.key}
                priority={issue.priority}
                id="issue-priority"
              />
            </Fact>
            <Fact label="Project">
              <span className="inline-flex items-center gap-1.5">
                <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                {label}
              </span>
            </Fact>
            {issue.jira_key && (
              <Fact label="Jira">
                <span className="font-mono text-xs">{issue.jira_key}</span>
              </Fact>
            )}
          </Facts>
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
      </aside>
    </div>
  );
}
