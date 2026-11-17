// Start screen for a project: greeting, the new-task composer, and a board of the project's
// numbers under it. Layout inspired by Affect UI's "AI Chat / Start" and "AI Chat / Overview"
// screens (https://www.affectui.com/screens/assistant-home, /assistant-overview); original
// implementation, no Affect UI source or assets.
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Stage, TaskRecord } from '@factory/core';
import { TaskChatComposer } from '@/components/task-chat';
import { ACTIVITY_WEEKS, overview } from '@/lib/overview';
import { cn } from '@/lib/utils';

const STAGE_DOT: Partial<Record<Stage, string>> = {
  blocked: 'bg-destructive',
  failed: 'bg-destructive',
  'verification-failed': 'bg-destructive',
  coding: 'bg-blue-500',
  reviewing: 'bg-blue-500',
  'awaiting-approval': 'bg-amber-500',
  approved: 'bg-emerald-500',
  'pr-opened': 'bg-emerald-500',
};

function taskTitle(prompt: string): string {
  return (
    prompt
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? prompt.trim()
  );
}

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const id = `home-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-xs">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id={id} className="text-sm font-medium">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TaskRows({
  project,
  tasks,
  meta,
}: {
  project: string;
  tasks: TaskRecord[];
  meta: (t: TaskRecord) => string;
}) {
  return (
    <ul className="-mx-2 flex flex-col">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link
            href={`/projects/${project}/tasks/${t.id}`}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:py-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span
              className={cn('size-1.5 shrink-0 rounded-full', STAGE_DOT[t.stage] ?? 'bg-muted-foreground/40')}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{taskTitle(t.prompt)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{meta(t)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const LEVEL = [
  'bg-muted',
  'bg-emerald-200 dark:bg-emerald-900',
  'bg-emerald-400 dark:bg-emerald-700',
  'bg-emerald-600 dark:bg-emerald-500',
];

function level(count: number, max: number): number {
  if (count === 0) return 0;
  return Math.min(3, Math.ceil((count / Math.max(1, max)) * 3));
}

function ago(iso: string | undefined, now: Date): string {
  if (!iso) return '';
  const s = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function ProjectHome({
  project,
  tasks,
  userName,
}: {
  project: string;
  tasks: TaskRecord[] | undefined;
  userName?: string;
}) {
  const now = new Date();
  const board = tasks ? overview(tasks, now) : undefined;
  const max = board ? Math.max(...board.activity.map((d) => d.count)) : 0;
  const first = userName?.split(/\s+/)[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col px-6 pt-[12vh] pb-10">
        <div className="mx-auto w-full max-w-3xl px-6 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting(now)}
            {first ? `, ${first}` : ''}
          </h1>
          <p className="mt-1 text-muted-foreground">
            What should we work on in <span className="font-medium text-foreground">{project}</span>?
          </p>
        </div>
        <TaskChatComposer mode="new" project={project} />

        <div className="mt-8">
          {!board ? (
            <p className="text-center text-sm text-destructive">Tasks unavailable</p>
          ) : tasks!.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <p className="font-medium">Nothing here yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your tasks, their activity and what they cost will show up here once you start one.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card title="Activity">
                <p className="mb-3 text-xs text-muted-foreground">
                  {board.activityTotal} events in the last {ACTIVITY_WEEKS} weeks
                </p>
                <div
                  role="img"
                  aria-label={`${board.activityTotal} task events in the last ${ACTIVITY_WEEKS} weeks`}
                  className="grid grid-flow-col grid-rows-7 gap-[3px] self-start"
                >
                  {board.activity.map((d) => (
                    <span
                      key={d.date}
                      title={`${d.date}: ${d.count} event${d.count === 1 ? '' : 's'}`}
                      className={cn('size-2.5 rounded-[2px]', LEVEL[level(d.count, max)])}
                    />
                  ))}
                </div>
              </Card>

              <Card
                title="Recent tasks"
                action={
                  board.recent.length > 5 && (
                    <Link
                      href={`/projects/${project}/tasks`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      {board.recent.length - 5} more
                    </Link>
                  )
                }
              >
                <TaskRows
                  project={project}
                  tasks={board.recent.slice(0, 5)}
                  meta={(t) => ago(t.updated_at ?? t.created_at, now)}
                />
              </Card>

              <Card title="Needs you">
                {board.needsYou.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing is waiting on you.</p>
                ) : (
                  <TaskRows
                    project={project}
                    tasks={board.needsYou.slice(0, 5)}
                    meta={(t) => t.stage.replace('-', ' ')}
                  />
                )}
              </Card>

              <Card title="This month">
                <dl className="flex flex-col gap-3">
                  {board.month.map((s) => (
                    <div key={s.label}>
                      <dt className="text-xs text-muted-foreground">{s.label}</dt>
                      <dd className="flex items-baseline gap-2">
                        <span className="text-lg font-semibold tabular-nums">{s.value}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {s.delta} on last month
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
