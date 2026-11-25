'use client';
// The project's task board: one column per status. Dragging a card, or its "Move to" menu, asks the
// backend to apply the drop (see dropAction in packages/core/src/issues.ts).
import { Menu } from '@base-ui/react/menu';
import { Archive, LoaderCircle, MoreHorizontal, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useRef, useState, useTransition, type DragEvent } from 'react';
import { archiveIssue, createIssue, moveIssue } from '@/app/actions';
import { Button } from '@/components/ui/button';
import {
  dropAction,
  ISSUE_STATUSES,
  runWorking,
  type DropAction,
  type IssueStatus,
  type Stage,
} from '@factory/core';
import { STATUS as COLUMNS } from '@/components/task-status';
import { useConfirm, type Confirm, type ConfirmRequest } from '@/components/confirm-dialog';
import { cn } from '@/lib/utils';

export type BoardIssue = {
  key: string;
  title: string;
  description: string;
  status: IssueStatus;
  jira_key?: string;
  updated_at: string;
  run?: { id: string; stage: Stage; updated_at?: string };
};

const STAGE_LABEL: Partial<Record<Stage, string>> = {
  queued: 'Queued',
  classified: 'Classified',
  coding: 'Coding',
  reviewing: 'Reviewing',
  'awaiting-approval': 'Awaiting approval',
  'verification-failed': 'Checks failed',
  approved: 'Approved',
  'pr-opened': 'PR opened',
  blocked: 'Blocked',
  failed: 'Failed',
  rejected: 'Rejected',
};

/**
 * The drop's action once the person agrees, or its refusal. Undefined when they decline: a drop
 * that starts, reruns or cancels paid model work never happens without a yes.
 */
export async function decideDrop(
  issue: Pick<BoardIssue, 'key' | 'status' | 'run'>,
  to: IssueStatus,
  confirm: Confirm,
): Promise<DropAction | undefined> {
  const action = dropAction(issue.status, to, issue.run);
  const request: ConfirmRequest | undefined =
    action.kind === 'start-run'
      ? {
          title: `Start a run for ${issue.key}?`,
          body: 'The coding agent classifies, codes, verifies and reviews the task in a new worktree, then stops for your approval. This uses paid model calls.',
          confirm: 'Start run',
        }
      : action.kind === 'run'
        ? {
            title: `Run ${issue.key} again?`,
            body: 'The coding agent runs again in the existing worktree, then stops for your approval. This uses paid model calls.',
            confirm: 'Run again',
          }
        : action.kind === 'reject'
          ? {
              title: `Cancel the run for ${issue.key}?`,
              body: 'The run is rejected and the task moves to Cancelled. Its worktree and branch stay, so you can still inspect or revise them.',
              confirm: 'Cancel run',
              cancel: 'Keep run',
              tone: 'destructive',
            }
          : undefined;
  if (request && !(await confirm(request))) return undefined;
  return action;
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Plain text for a card preview: Markdown marks dropped, the title line skipped if repeated. */
function preview(issue: BoardIssue): string {
  return issue.description
    .split('\n')
    .map((l) => l.replace(/^#+\s*|[*_`>]/g, '').trim())
    .filter((l) => l && l !== issue.title)
    .join(' ');
}

function NewTaskForm({
  project,
  status,
  onDone,
}: {
  project: string;
  status: 'backlog' | 'todo';
  onDone: (message?: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const submit = () =>
    start(async () => {
      const result = await createIssue(project, { title, status });
      if (result.error) setError(result.error);
      else onDone(result.message);
    });
  return (
    <form
      className="rounded-xl border bg-card p-2 shadow-xs"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={`new-${status}`} className="sr-only">
        New task title
      </label>
      <textarea
        id={`new-${status}`}
        autoFocus
        rows={2}
        maxLength={200}
        value={title}
        placeholder="What needs doing?"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone();
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (title.trim()) submit();
          }
        }}
        className="w-full resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      {error && (
        <p role="alert" className="px-1.5 pb-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!title.trim() || pending}>
          {pending ? 'Adding…' : 'Add task'}
        </Button>
      </div>
    </form>
  );
}

export function TaskBoard({ project, issues, now }: { project: string; issues: BoardIssue[]; now: number }) {
  const router = useRouter();
  const [items, setOptimistic] = useOptimistic(issues, (current, move: { key: string; to: IssueStatus }) =>
    current.map((i) => (i.key === move.key ? { ...i, status: move.to } : i)),
  );
  const [, startMove] = useTransition();
  const [creating, setCreating] = useState<'backlog' | 'todo'>();
  const [dragging, setDragging] = useState<BoardIssue>();
  const [over, setOver] = useState<IssueStatus>();
  const [notice, setNotice] = useState<{ kind: 'error' | 'status'; text: string }>();
  const moving = useRef(new Set<string>());

  const [confirm, confirmDialog] = useConfirm();
  const move = async (issue: BoardIssue, to: IssueStatus) => {
    const action = await decideDrop(issue, to, confirm);
    if (!action || action.kind === 'none') return;
    if (action.kind === 'refused') {
      setNotice({ kind: 'error', text: `${issue.key}: ${action.reason}` });
      return;
    }
    if (moving.current.has(issue.key)) return;
    moving.current.add(issue.key);
    setNotice(undefined);
    startMove(async () => {
      setOptimistic({
        key: issue.key,
        to:
          action.kind === 'reject'
            ? 'cancelled'
            : action.kind === 'set-status'
              ? action.status
              : 'in_progress',
      });
      const result = await moveIssue(project, issue.key, to);
      moving.current.delete(issue.key);
      setNotice(
        result.error
          ? { kind: 'error', text: `${issue.key}: ${result.error}` }
          : { kind: 'status', text: result.message ?? '' },
      );
      router.refresh();
    });
  };

  const archive = (issue: BoardIssue) =>
    startMove(async () => {
      const result = await archiveIssue(project, issue.key, true);
      setNotice(
        result.error
          ? { kind: 'error', text: `${issue.key}: ${result.error}` }
          : { kind: 'status', text: `${result.message} Restore it from Archived in the sidebar.` },
      );
      router.refresh();
    });

  const onDrop = (to: IssueStatus) => (e: DragEvent) => {
    e.preventDefault();
    setOver(undefined);
    const key = e.dataTransfer.getData('text/x-task-key') || dragging?.key;
    const issue = items.find((i) => i.key === key);
    setDragging(undefined);
    if (issue) move(issue, to);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {confirmDialog}
      <header className="flex flex-wrap items-end justify-between gap-3 px-6 pt-6 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag a task to In progress to start a run, or to Cancelled to stop one.
          </p>
        </div>
        <Button variant="outline" onClick={() => setCreating('backlog')}>
          <Plus aria-hidden /> New task
        </Button>
      </header>
      <p
        role={notice?.kind === 'error' ? 'alert' : 'status'}
        className={cn(
          'min-h-5 px-6 pb-2 text-sm',
          notice?.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {notice?.text}
      </p>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 pb-6">
        {ISSUE_STATUSES.map((status) => {
          const column = COLUMNS[status];
          const Icon = column.icon;
          const cards = items.filter((i) => i.status === status);
          const verdict = dragging ? dropAction(dragging.status, status, dragging.run) : undefined;
          const accepts = verdict && verdict.kind !== 'refused' && verdict.kind !== 'none';
          return (
            <section
              key={status}
              aria-labelledby={`column-${status}`}
              onDragOver={(e) => {
                if (!dragging) return;
                // Refused columns still take the drop, so the board can say why it was refused.
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver(accepts ? status : undefined);
              }}
              onDragLeave={() => setOver((o) => (o === status ? undefined : o))}
              onDrop={onDrop(status)}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-2xl border border-transparent bg-muted/50 motion-safe:transition-colors',
                dragging && accepts && 'border-dashed border-border',
                dragging && verdict?.kind === 'refused' && 'opacity-60',
                over === status && 'border-primary/40 bg-primary/5',
              )}
            >
              <div className="flex items-center gap-2 px-3 pt-3 pb-2">
                <Icon className={cn('size-4', column.tone)} aria-hidden />
                <h2 id={`column-${status}`} className="text-sm font-semibold">
                  {column.label}
                </h2>
                <span className="text-xs text-muted-foreground tabular-nums">{cards.length}</span>
                {(status === 'backlog' || status === 'todo') && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    aria-label={`Add a task to ${column.label}`}
                    onClick={() => setCreating(status)}
                  >
                    <Plus aria-hidden />
                  </Button>
                )}
              </div>
              <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {creating === status && (
                  <li>
                    <NewTaskForm
                      project={project}
                      status={status as 'backlog' | 'todo'}
                      onDone={(message) => {
                        setCreating(undefined);
                        if (message) {
                          setNotice({ kind: 'status', text: message });
                          router.refresh();
                        }
                      }}
                    />
                  </li>
                )}
                {cards.length === 0 && creating !== status && (
                  <li className="px-1 py-6 text-center text-xs text-muted-foreground">No tasks</li>
                )}
                {cards.map((issue) => (
                  <li
                    key={issue.key}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/x-task-key', issue.key);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(issue);
                    }}
                    onDragEnd={() => {
                      setDragging(undefined);
                      setOver(undefined);
                    }}
                    className={cn(
                      'group relative cursor-grab rounded-xl border bg-card p-3 shadow-xs hover:border-foreground/20 active:cursor-grabbing has-[a:focus-visible]:border-ring',
                      dragging?.key === issue.key && 'opacity-50',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{issue.key}</span>
                      {issue.jira_key && (
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          · {issue.jira_key}
                        </span>
                      )}
                      <MoveMenu
                        issue={issue}
                        onMove={(to) => move(issue, to)}
                        onArchive={() => archive(issue)}
                      />
                    </div>
                    {/* The link covers the card; the menu sits above it. */}
                    <Link
                      href={`/projects/${project}/tasks/${issue.key}`}
                      draggable={false}
                      className="mt-1 line-clamp-2 text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl"
                    >
                      {issue.title}
                    </Link>
                    {preview(issue) && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preview(issue)}</p>
                    )}
                    <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
                      {issue.run ? (
                        <span className="inline-flex items-center gap-1">
                          {issue.run.stage === 'coding' || issue.run.stage === 'reviewing' ? (
                            <LoaderCircle className="size-3 motion-safe:animate-spin" aria-hidden />
                          ) : null}
                          {STAGE_LABEL[issue.run.stage] ?? issue.run.stage}
                        </span>
                      ) : (
                        <span>No run yet</span>
                      )}
                      <time dateTime={issue.updated_at} className="ml-auto tabular-nums">
                        {ago(issue.updated_at, now)}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function MoveMenu({
  issue,
  onMove,
  onArchive,
}: {
  issue: BoardIssue;
  onMove: (to: IssueStatus) => void;
  /** Adds an Archive item; archiving is undone from the Archived page. */
  onArchive?: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Move ${issue.key}`}
        className="relative z-10 ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-has-[a:focus-visible]:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-fine:data-popup-open:opacity-100"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4} className="z-50">
          <Menu.Popup className="w-52 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none motion-safe:transition-opacity motion-safe:duration-100 data-starting-style:opacity-0 data-ending-style:opacity-0">
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Move to</p>
            {ISSUE_STATUSES.filter((s) => s !== issue.status).map((status) => {
              const { label, icon: Icon, tone } = COLUMNS[status];
              const verdict = dropAction(issue.status, status, issue.run);
              const refused = verdict.kind === 'refused';
              return (
                <Menu.Item
                  key={status}
                  disabled={refused}
                  onClick={() => onMove(status)}
                  title={refused ? verdict.reason : undefined}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-muted"
                >
                  <Icon className={cn('size-4', tone)} aria-hidden />
                  {label}
                  {verdict.kind === 'start-run' && (
                    <span className="ml-auto text-xs text-muted-foreground">Starts a run</span>
                  )}
                  {verdict.kind === 'run' && (
                    <span className="ml-auto text-xs text-muted-foreground">Runs again</span>
                  )}
                  {verdict.kind === 'reject' && (
                    <span className="ml-auto text-xs text-muted-foreground">Stops the run</span>
                  )}
                </Menu.Item>
              );
            })}
            {onArchive && (
              <>
                <Menu.Separator className="my-1 h-px bg-border" />
                <Menu.Item
                  disabled={!!issue.run && runWorking(issue.run.stage)}
                  title={
                    issue.run && runWorking(issue.run.stage)
                      ? 'Wait for the run to stop, or cancel it.'
                      : undefined
                  }
                  onClick={onArchive}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-muted"
                >
                  <Archive className="size-4 text-muted-foreground" aria-hidden />
                  Archive
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
