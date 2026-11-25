'use client';
// The sidebar's work lists: open board tasks, then their agents (runs) grouped by what they need.
import { Bot, LoaderCircle } from 'lucide-react';
import type { IssueStatus, Stage } from '@factory/core';
import { STATUS } from '@/components/task-status';
import { cn } from '@/lib/utils';
import { SidebarLink } from '@/components/sidebar-link';
import { AgentAvatar } from '@/components/agent-avatar';
import { SidebarTaskMenu } from '@/components/sidebar-task-menu';
import { useEffect, useState } from 'react';

/** Task keys stay readable on the plain row and on the tinted current row. */
const KEY = 'shrink-0 font-mono text-xs font-medium text-foreground/75 tabular-nums';

export interface IssueSummary {
  key: string;
  title: string;
  status: IssueStatus;
  archived: boolean;
  updated_at: string;
  /** `waiting`: a new turn is queued until the agent is free. */
  run?: { stage: Stage; waiting?: boolean };
  /** The agent assigned to the task. */
  agent?: { id: string; name: string; avatar: string };
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
/** A queued turn waits for its agent, so it is idle work, not something that needs you. */
const groupOf = (run: { stage: Stage; waiting?: boolean }): Group | undefined =>
  run.waiting ? 'idle' : GROUP_OF[run.stage];

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

export function SidebarWork({
  project,
  issues,
  activeKey,
  onChanged = () => {},
}: {
  project: string;
  issues: IssueSummary[];
  activeKey: string | undefined;
  /** Called after a menu action changed a task, to reload the lists. */
  onChanged?: () => void;
}) {
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'status' }>();
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), notice.tone === 'error' ? 8000 : 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  const menu = (i: IssueSummary) => (
    <SidebarTaskMenu
      project={project}
      task={{ key: i.key, title: i.title }}
      onChanged={onChanged}
      onNotice={(text, tone = 'status') => setNotice({ text, tone })}
    />
  );
  const live = issues.filter((i) => !i.archived);
  const open = live
    .filter((i) => OPEN.includes(i.status))
    .sort(
      (a, b) => OPEN.indexOf(a.status) - OPEN.indexOf(b.status) || b.updated_at.localeCompare(a.updated_at),
    );
  const cutoff = Date.now() - DONE_DAYS * 86_400_000;
  const agents = live
    .filter((i) => i.run && groupOf(i.run))
    .filter((i) => groupOf(i.run!) !== 'done' || Date.parse(i.updated_at) > cutoff)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const href = (key: string) => `/projects/${project}/tasks/${key}`;

  return (
    <>
      <section aria-labelledby="sidebar-tasks">
        <h2 id="sidebar-tasks" className="px-2 pt-2 pb-1 text-xs font-medium text-foreground/75">
          Tasks
        </h2>
        {open.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-foreground/75">No open tasks</p>
        ) : (
          <ul className="flex flex-col gap-px">
            {open.map((i) => {
              const { icon: Icon, tone, label } = STATUS[i.status];
              return (
                <li key={i.key} className="group/row relative">
                  <SidebarLink
                    href={href(i.key)}
                    current={i.key === activeKey}
                    title={`${i.key} ${i.title} (${label})`}
                    className="pr-8 pl-2"
                  >
                    <Icon className={cn('size-3.5 shrink-0', tone)} aria-hidden />
                    <span className={KEY}>{i.key}</span>
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <span className="sr-only">, {label}</span>
                  </SidebarLink>
                  {menu(i)}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="sidebar-agents" className="mt-4">
        <h2 id="sidebar-agents" className="px-2 pt-2 pb-1 text-xs font-medium text-foreground/75">
          Agents
        </h2>
        {agents.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-foreground/75">
            No agent is working. Assign a Todo task to an agent to start one.
          </p>
        ) : (
          GROUPS.map((group) => {
            const members = agents.filter((i) => groupOf(i.run!) === group.id);
            if (!members.length) return null;
            return (
              <div key={group.id} className="mt-1">
                <h3 className={cn('px-2 pt-1.5 pb-0.5 text-xs font-medium', group.tone)}>
                  {group.label} <span className="text-foreground/75 tabular-nums">{members.length}</span>
                </h3>
                <ul className="flex flex-col gap-px">
                  {members.map((i) => (
                    <li key={i.key} className="group/row relative">
                      <SidebarLink href={href(i.key)} current={i.key === activeKey} className="pr-8 pl-2">
                        {i.agent ? (
                          <span title={i.agent.name} className="shrink-0">
                            <AgentAvatar agent={i.agent} size="sm" />
                          </span>
                        ) : (
                          <span
                            title="Pipeline run"
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border bg-muted/60"
                          >
                            <Bot className="size-3 text-muted-foreground" aria-label="Pipeline run" />
                          </span>
                        )}
                        <span className={KEY}>{i.key}</span>
                        <span className="min-w-0 flex-1 truncate">{i.title}</span>
                        <span className="shrink-0 text-xs text-foreground/75 tabular-nums">
                          {ago(i.updated_at)}
                        </span>
                        {group.id === 'working' && (
                          <LoaderCircle
                            className="size-3.5 shrink-0 text-amber-600 motion-safe:animate-spin dark:text-amber-400"
                            aria-label="Working"
                          />
                        )}
                        {/* The group already says it needs you; only a reason other than "blocked" adds anything. */}
                        {group.id === 'needs' && i.run!.stage !== 'blocked' && (
                          <span className="shrink-0 text-xs text-foreground/75">{NEEDS[i.run!.stage]}</span>
                        )}
                        {i.run!.waiting && (
                          <span className="shrink-0 text-xs text-foreground/75">waiting</span>
                        )}
                        {group.id === 'done' && <span className="sr-only">, pull request opened</span>}
                      </SidebarLink>
                      {menu(i)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>
      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'mt-2 px-2 text-xs',
            notice.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {notice.text}
        </p>
      )}
    </>
  );
}
