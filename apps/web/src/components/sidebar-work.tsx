'use client';
// The sidebar's work lists: open board tasks, then their agents (runs) grouped by what they need.
import { Bot, CircleAlert, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import type { IssueStatus, Stage } from '@factory/core';
import { STATUS } from '@/components/task-status';
import { cn } from '@/lib/utils';

export interface IssueSummary {
  key: string;
  title: string;
  status: IssueStatus;
  archived: boolean;
  updated_at: string;
  run?: { stage: Stage };
}

type Group = 'needs' | 'working' | 'idle' | 'done';
const GROUP_OF: Partial<Record<Stage, Group>> = {
  'awaiting-approval': 'needs',
  approved: 'needs',
  blocked: 'needs',
  failed: 'needs',
  'verification-failed': 'needs',
  coding: 'working',
  reviewing: 'working',
  queued: 'idle',
  classified: 'idle',
  'pr-opened': 'done',
};
const GROUPS: { id: Group; label: string; tone: string }[] = [
  { id: 'needs', label: 'Needs you', tone: 'text-destructive' },
  { id: 'working', label: 'Working', tone: 'text-amber-700 dark:text-amber-400' },
  { id: 'idle', label: 'Idle', tone: 'text-muted-foreground' },
  { id: 'done', label: 'Done', tone: 'text-blue-700 dark:text-blue-400' },
];
const NEEDS: Partial<Record<Stage, string>> = {
  'awaiting-approval': 'review',
  approved: 'open PR',
  blocked: 'blocked',
  failed: 'failed',
  'verification-failed': 'checks failed',
};
const OPEN: IssueStatus[] = ['in_progress', 'in_review', 'blocked', 'todo', 'backlog'];
/** Done agents older than this leave the list; the board keeps them. */
const DONE_DAYS = 7;

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return '<1m';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const row =
  'flex items-center gap-2 rounded-lg px-2 py-1.5 pointer-coarse:py-3 text-sm transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring';
const current = 'bg-background shadow-xs hover:bg-background';

export function SidebarWork({
  project,
  issues,
  activeKey,
}: {
  project: string;
  issues: IssueSummary[];
  activeKey: string | undefined;
}) {
  const live = issues.filter((i) => !i.archived);
  const open = live
    .filter((i) => OPEN.includes(i.status))
    .sort(
      (a, b) => OPEN.indexOf(a.status) - OPEN.indexOf(b.status) || b.updated_at.localeCompare(a.updated_at),
    );
  const cutoff = Date.now() - DONE_DAYS * 86_400_000;
  const agents = live
    .filter((i) => i.run && GROUP_OF[i.run.stage])
    .filter((i) => GROUP_OF[i.run!.stage] !== 'done' || Date.parse(i.updated_at) > cutoff)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const href = (key: string) => `/projects/${project}/tasks/${key}`;

  return (
    <>
      <section aria-labelledby="sidebar-tasks">
        <h2 id="sidebar-tasks" className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
          Tasks
        </h2>
        {open.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No open tasks</p>
        ) : (
          <ul className="flex flex-col gap-px">
            {open.map((i) => {
              const { icon: Icon, tone, label } = STATUS[i.status];
              return (
                <li key={i.key}>
                  <Link
                    href={href(i.key)}
                    aria-current={i.key === activeKey ? 'page' : undefined}
                    title={`${i.key} ${i.title} (${label})`}
                    className={cn(row, i.key === activeKey && current)}
                  >
                    <Icon className={cn('size-3.5 shrink-0', tone)} aria-hidden />
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{i.key}</span>
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <span className="sr-only">, {label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="sidebar-agents" className="mt-4">
        <h2 id="sidebar-agents" className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
          Agents
        </h2>
        {agents.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No agent is working. Move a task to In progress to start one.
          </p>
        ) : (
          GROUPS.map((group) => {
            const members = agents.filter((i) => GROUP_OF[i.run!.stage] === group.id);
            if (!members.length) return null;
            return (
              <div key={group.id} className="mt-1">
                <h3 className={cn('px-2 pt-1.5 pb-0.5 text-xs font-medium', group.tone)}>
                  {group.label} <span className="text-muted-foreground tabular-nums">{members.length}</span>
                </h3>
                <ul className="flex flex-col gap-px">
                  {members.map((i) => (
                    <li key={i.key}>
                      <Link
                        href={href(i.key)}
                        aria-current={i.key === activeKey ? 'page' : undefined}
                        className={cn(row, i.key === activeKey && current)}
                      >
                        <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-mono text-xs text-muted-foreground">{i.key}</span> {i.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {ago(i.updated_at)}
                        </span>
                        {group.id === 'working' && (
                          <LoaderCircle
                            className="size-3.5 shrink-0 text-amber-600 motion-safe:animate-spin dark:text-amber-400"
                            aria-label="Working"
                          />
                        )}
                        {group.id === 'needs' && (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-destructive">
                            <CircleAlert className="size-3.5" aria-hidden />
                            {NEEDS[i.run!.stage]}
                          </span>
                        )}
                        {group.id === 'done' && <span className="sr-only">, pull request opened</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}
