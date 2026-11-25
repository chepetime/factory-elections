import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LocalTime } from '@/components/local-time';
import { Markdown } from '@/components/markdown';
import {
  IssueArchivedBanner,
  IssueCommentBox,
  IssueDescription,
  IssuePriorityField,
  IssueStatusField,
  IssueTitle,
} from '@/components/issue-editor';
import { StageBadge } from '@/components/stage-badge';
import { Fact, Facts, money, renderRun, Section } from '@/components/task-run';
import { isProjectName, isTaskId } from '@/lib/factory';
import { getIssue, type IssueView } from '@/lib/issues';
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

/** One entry in the activity feed: something that happened to the task itself. */
function Happening({ at, children }: { at: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline gap-3 py-1.5 text-sm text-muted-foreground">
      <span
        className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-muted-foreground/40"
        aria-hidden
      />
      <span className="min-w-0 flex-1">{children}</span>
      <LocalTime iso={at} format="date-time" className="shrink-0 text-xs tabular-nums" />
    </li>
  );
}

function Comment({ at, body }: { at: string; body: string }) {
  return (
    <li className="my-2 rounded-xl border bg-card px-4 py-3 shadow-xs">
      <p className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">You</span>
        <LocalTime iso={at} format="date-time" />
      </p>
      <div className="mt-1.5 text-sm">
        <Markdown text={body} />
      </div>
    </li>
  );
}

/** Issue events and comments, oldest first, with the time each one happened. */
function happenings(issue: IssueView) {
  return [
    ...issue.events.map((e) => ({
      at: e.at,
      node: (
        <Happening key={`e-${e.at}-${e.kind}`} at={e.at}>
          {e.message}
        </Happening>
      ),
    })),
    ...issue.comments.map((c) => ({ at: c.at, node: <Comment key={c.id} at={c.at} body={c.body} /> })),
  ].sort((a, b) => a.at.localeCompare(b.at));
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
  const feed = happenings(issue);
  const before = runStart === undefined ? feed : feed.filter((h) => h.at < runStart);
  const after = runStart === undefined ? [] : feed.filter((h) => h.at >= runStart);
  const runIndex = runId ? issue.runs.indexOf(runId) + 1 : 0;

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
            <ol className="mt-3">{before.map((h) => h.node)}</ol>

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
            <ol className="mt-3">{after.map((h) => h.node)}</ol>
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
            <Fact label="Priority">
              <IssuePriorityField
                project={project}
                issueKey={issue.key}
                priority={issue.priority}
                id="issue-priority"
              />
            </Fact>
            {issue.jira_key && (
              <Fact label="Jira">
                <span className="font-mono text-xs">{issue.jira_key}</span>
              </Fact>
            )}
            {run?.ok && (
              <Fact label="Cost">
                <span className="tabular-nums">{money(run.value.task)}</span>
              </Fact>
            )}
            <Fact label="Created">
              <LocalTime iso={issue.created_at} format="date-time" />
            </Fact>
            <Fact label="Updated">
              <LocalTime iso={issue.updated_at} format="date-time" />
            </Fact>
          </Facts>
        </Section>

        {issue.runs.length > 0 && (
          <Section title="Runs">
            <ol className="flex flex-col text-sm">
              {issue.runs.map((rid, i) => (
                <li key={rid}>
                  <Link
                    href={`/projects/${project}/tasks/${issue.key}${rid === issue.run?.id ? '' : `?run=${rid}`}`}
                    aria-current={rid === runId ? 'true' : undefined}
                    className={cn(
                      '-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted',
                      rid === runId && 'bg-muted font-medium',
                    )}
                  >
                    Run {i + 1}
                    {rid === issue.run?.id && <span className="text-xs text-muted-foreground">latest</span>}
                    <span className="ml-auto truncate font-mono text-xs text-muted-foreground">
                      {rid.slice(0, 8)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {run?.ok && run.value.sections}
      </aside>
    </div>
  );
}
