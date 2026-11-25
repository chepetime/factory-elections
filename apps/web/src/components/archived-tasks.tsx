'use client';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { IssueStatus } from '@factory/core';
import { archiveIssue, deleteIssue } from '@/app/actions';
import { useConfirm } from '@/components/confirm-dialog';
import { LocalTime } from '@/components/local-time';
import { StatusLabel } from '@/components/task-status';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ArchivedTask = {
  key: string;
  title: string;
  status: IssueStatus;
  archived_at: string;
  runs: number;
};

export function ArchivedTasks({ project, tasks }: { project: string; tasks: ArchivedTask[] }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState<string>();
  const [, start] = useTransition();
  const [notice, setNotice] = useState<{ kind: 'error' | 'status'; text: string }>();

  const act = (task: ArchivedTask, work: () => Promise<{ error?: string; message?: string }>) => {
    setBusy(task.key);
    setNotice(undefined);
    start(async () => {
      const result = await work();
      setNotice(
        result.error
          ? { kind: 'error', text: `${task.key}: ${result.error}` }
          : { kind: 'status', text: result.message ?? '' },
      );
      setBusy(undefined);
      router.refresh();
    });
  };
  const remove = async (task: ArchivedTask) => {
    const yes = await confirm({
      title: `Delete ${task.key} for good?`,
      body:
        task.runs > 0
          ? `This deletes the task and its ${task.runs === 1 ? 'run' : `${task.runs} runs`}: worktrees, branches and run records. Traces and cost history stay. You cannot undo this.`
          : 'This deletes the task, its description and its comments. You cannot undo this.',
      confirm: 'Delete',
      cancel: 'Keep it',
      tone: 'destructive',
    });
    if (yes) act(task, () => deleteIssue(project, task.key));
  };

  return (
    <div className="h-full overflow-y-auto">
      {confirmDialog}
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Archived tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Archived tasks leave the board and the sidebar and keep their runs. Restore one to put it back, or
          delete it for good.
        </p>
        <p
          role={notice?.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'mt-4 min-h-5 text-sm',
            notice?.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {notice?.text}
        </p>
        {tasks.length === 0 ? (
          <div className="mt-2 rounded-2xl border border-dashed p-8 text-center">
            <p className="font-medium">Nothing archived</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Archive a task from its menu on the{' '}
              <Link href={`/projects/${project}/tasks`} className="underline underline-offset-2">
                board
              </Link>{' '}
              or from its page.
            </p>
          </div>
        ) : (
          <ul className="mt-2 divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
            {tasks.map((task) => (
              <li
                key={task.key}
                className={cn(
                  'flex flex-wrap items-center gap-3 px-5 py-3.5',
                  busy === task.key && 'opacity-60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/projects/${project}/tasks/${task.key}`}
                    className="flex min-w-0 items-baseline gap-2 hover:underline"
                  >
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.key}</span>
                    <span className="truncate text-sm font-medium">{task.title}</span>
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <StatusLabel status={task.status} className="[&_svg]:size-3.5" />
                    <span aria-hidden>·</span>
                    <span>
                      Archived <LocalTime iso={task.archived_at} format="date-time" />
                    </span>
                    <span aria-hidden>·</span>
                    <span>{task.runs === 1 ? '1 run' : `${task.runs} runs`}</span>
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => act(task, () => archiveIssue(project, task.key, false))}
                >
                  <ArchiveRestore aria-hidden /> Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!busy}
                  className="text-destructive hover:text-destructive"
                  aria-label={`Delete ${task.key}`}
                  onClick={() => remove(task)}
                >
                  <Trash2 aria-hidden /> Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
