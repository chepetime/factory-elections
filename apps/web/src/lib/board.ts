// The board: every active task in one of four columns that answer "what is progressing, what
// needs me, what can I review, what can I finish" (docs/vision/ui.md). Pure: the page loads tasks,
// run phases, inbox items and open PRs, and this module decides the column and the card fields.
//
// Each task lands in exactly one column, by the first rule that matches:
//
//   1. Working   — a run owns the task (phase queued, running or finalizing). Working wins over
//                  Needs me: an inbox item waits on the human only when no agent works on the task
//                  (packages/core/src/inbox.ts), so an item beside a live run is stale.
//   2. Needs me  — an open inbox item names the task (gate items excepted, see 5), or the stage is
//                  `blocked` (the classifier needs an answer).
//   3. Archived  — rejected; failed with no open inbox item (dismissed); or its PR is no longer
//                  open (merged or closed) when the open-PR list is known. Not on the board.
//   4. Ready     — approved without a PR yet (next step: open it), or the PR is approved and not a
//                  draft (next step: merge it). Ready is the "finish it" part of what needs you:
//                  the core rule (`runAttention`) calls an approved run "needs you", and the
//                  sidebar and home count it there.
//   5. In review — the stage is `awaiting-approval` (the gate is the review, so its inbox item does
//                  not move the task to Needs me), or a PR is open and waits on people or checks.
//   6. Working   — the rest (queued, classified, coding, reviewing) with no live run: the workflow
//                  is mid-way. The live line says when the run was interrupted.
//
// Card fields come only from recorded state. When a field is missing, it is left out.
import {
  executionBusy,
  runNeed,
  taskTitle,
  type ExecutionPhase,
  type PullRequestSummary,
  type Stage,
  type TaskRecord,
} from '@factory/core';
import type { InboxItem } from '@/lib/inbox';

export const COLUMNS = ['working', 'needs-me', 'in-review', 'ready'] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABEL: Record<Column, string> = {
  working: 'Working',
  'needs-me': 'Needs me',
  'in-review': 'In review',
  ready: 'Ready',
};

/** What the page knows about a task's run. */
export interface BoardRun {
  phase: ExecutionPhase;
  label?: string;
  activity?: {
    run_started_at: string;
    command?: string;
    command_started_at?: string;
    last_output_at?: string;
  };
}

export interface BoardTask {
  task: TaskRecord;
  run?: BoardRun;
}

/** The fields of an open PR the board reads. */
export type BoardPull = Pick<
  PullRequestSummary,
  'number' | 'branch' | 'url' | 'isDraft' | 'decision' | 'author'
>;

export interface BoardInput {
  tasks: readonly BoardTask[];
  /** Open inbox items across projects. */
  inbox?: readonly InboxItem[];
  /**
   * Open PRs per project. A project that is missing (not loaded, or the load failed) has unknown
   * PR state: its PR tasks stay In review and are never archived as merged.
   */
  pulls?: Readonly<Record<string, readonly BoardPull[]>>;
}

/** Live line tone: the column color, or `danger` for an interrupted run, `muted` for no news. */
export type LiveTone = Column | 'danger' | 'muted';

export interface BoardCard {
  id: string;
  project: string;
  column: Column;
  stage: Stage;
  title: string;
  href: string;
  resource: { kind: 'branch' | 'repo'; text: string };
  pr?: { number: number; url: string; author?: string };
  live: { text: string; tone: LiveTone; at?: string };
  action?: { label: string; href: string; external?: boolean };
}

export interface Board {
  columns: Record<Column, BoardCard[]>;
  archived: number;
}

function latestEvent(task: TaskRecord) {
  return task.events?.findLast((e) => e.message.trim().length > 0);
}

function prNumber(url: string): number | undefined {
  const match = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
  return match ? Number(match[1]) : undefined;
}

function repoName(repo: string): string {
  return repo.split('/').filter(Boolean).at(-1) ?? repo;
}

/** The latest event's message and time, or the given fallback text at the task's last update. */
function eventLine(task: TaskRecord, tone: LiveTone, fallback: string): BoardCard['live'] {
  const event = latestEvent(task);
  const at = event?.at ?? task.updated_at ?? task.created_at;
  return { text: event ? firstLine(event.message) : fallback, tone, ...(at ? { at } : {}) };
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]!.trim();
}

const PULL_LINE: Record<BoardPull['decision'], string> = {
  review: 'Waiting for review',
  changes: 'Changes requested',
  approved: 'Approved',
};

export function buildBoard(input: BoardInput): Board {
  const columns: Record<Column, BoardCard[]> = { working: [], 'needs-me': [], 'in-review': [], ready: [] };
  let archived = 0;
  const itemsByTask = new Map<string, InboxItem[]>();
  for (const item of input.inbox ?? []) {
    if (!item.task_id || item.kind === 'gate') continue;
    const key = `${item.project}/${item.task_id}`;
    itemsByTask.set(key, [...(itemsByTask.get(key) ?? []), item]);
  }

  for (const { task, run } of input.tasks) {
    const href = `/projects/${encodeURIComponent(task.project)}/tasks/${encodeURIComponent(task.id)}`;
    const number = task.pr ? prNumber(task.pr.url) : undefined;
    const pulls = input.pulls?.[task.project];
    const pull = task.pr && pulls?.find((p) => p.branch === task.pr!.branch || p.number === number);
    const branch = task.pr?.branch ?? task.worktree?.branch;
    const base = {
      id: task.id,
      project: task.project,
      stage: task.stage,
      title: taskTitle(task),
      href,
      resource: branch
        ? { kind: 'branch' as const, text: branch }
        : { kind: 'repo' as const, text: repoName(task.repo) },
      ...(task.pr && (pull?.number ?? number) !== undefined
        ? {
            pr: {
              number: (pull?.number ?? number)!,
              url: pull?.url ?? task.pr.url,
              ...(pull?.author ? { author: pull.author } : {}),
            },
          }
        : {}),
    };
    const place = (column: Column, live: BoardCard['live'], action?: BoardCard['action']) =>
      columns[column].push({ ...base, column, live, ...(action ? { action } : {}) });

    // 1. Working: a run owns the task.
    if (run && executionBusy(run.phase)) {
      const activity = run.activity;
      const text = activity?.command ?? latestEvent(task)?.message ?? run.label ?? run.phase;
      const at =
        activity?.last_output_at ??
        activity?.command_started_at ??
        activity?.run_started_at ??
        latestEvent(task)?.at;
      place('working', { text: firstLine(text), tone: 'working', ...(at ? { at } : {}) });
      continue;
    }

    // 2. Needs me: an open inbox item, or the classifier's blocked stage.
    const items = itemsByTask.get(`${task.project}/${task.id}`);
    const item = items?.at(-1);
    if (item) {
      place('needs-me', { text: firstLine(item.detail ?? item.action), tone: 'needs-me', at: item.since });
      continue;
    }
    if (task.stage === 'blocked') {
      const questions = task.verdict?.blockers?.map((b) => b.question).filter(Boolean);
      place(
        'needs-me',
        questions?.length
          ? {
              text: firstLine(questions.join('; ')),
              tone: 'needs-me',
              ...(task.updated_at ? { at: task.updated_at } : {}),
            }
          : eventLine(task, 'needs-me', 'Blocked'),
      );
      continue;
    }

    // 3. Archived: off the board.
    const failed = task.stage === 'failed' || task.stage === 'verification-failed';
    const prClosed = task.pr !== undefined && pulls !== undefined && !pull;
    // A failure with no open inbox item was dismissed. With no inbox data that is unknown, so it stays.
    if (failed && input.inbox === undefined) {
      place('needs-me', eventLine(task, 'needs-me', 'Failed'));
      continue;
    }
    if (task.stage === 'rejected' || failed || prClosed) {
      archived++;
      continue;
    }

    // 4. Ready.
    if (runNeed(task.stage) === 'open PR' && !task.pr) {
      place('ready', eventLine(task, 'ready', 'Approved'), { label: 'Open PR', href });
      continue;
    }
    if (pull && pull.decision === 'approved' && !pull.isDraft) {
      place(
        'ready',
        { text: PULL_LINE.approved, tone: 'ready', at: task.pr!.at },
        {
          label: 'Merge',
          href: pull.url,
          external: true,
        },
      );
      continue;
    }

    // 5. In review.
    if (task.stage === 'awaiting-approval') {
      place('in-review', eventLine(task, 'in-review', 'Awaiting approval'), { label: 'Review', href });
      continue;
    }
    if (task.pr || task.stage === 'pr-opened') {
      place(
        'in-review',
        pull && task.pr
          ? { text: pull.isDraft ? 'Draft' : PULL_LINE[pull.decision], tone: 'in-review', at: task.pr.at }
          : eventLine(task, 'in-review', 'PR opened'),
      );
      continue;
    }

    // 6. Working, with no live run.
    if (run?.phase === 'interrupted') {
      const at = latestEvent(task)?.at ?? task.updated_at;
      place('working', { text: 'Run interrupted', tone: 'danger', ...(at ? { at } : {}) });
    } else place('working', eventLine(task, 'muted', task.stage));
  }

  const time = (c: BoardCard) => c.live.at ?? '';
  for (const column of COLUMNS) columns[column].sort((a, b) => time(b).localeCompare(time(a)));
  return { columns, archived };
}

/** Whether the task needs a run lookup: only tasks that could still have a live run do. */
export function mayRun(task: TaskRecord): boolean {
  return task.stage !== 'rejected' && task.stage !== 'pr-opened' && !task.pr;
}

/** A short age such as "now", "3m ago", "2h ago" or "4d ago". */
export function age(iso: string | undefined, now: number): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
