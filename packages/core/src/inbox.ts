// One inbox. One rule decides what waits on the human:
//
//   An item waits on the human when its next step needs a human decision and no agent works on it.
//
// Everything else goes on without the human. Each item has a stable id built from what it is and
// when it began to wait, so a dismissal holds until the item waits again for a new reason. The
// time between `since` and its resolution is the human's attention cost (see gate spans).
import type { Feature } from './features.ts';
import type { RetroFinding } from './retro.ts';
import type { TaskRecord } from './schemas.ts';

export type InboxKind =
  /** A task at the approval gate. */
  | 'gate'
  /** A task the classifier stopped: it needs clarification, research or slicing. */
  | 'blocked'
  /** A task, feature step or ticket that failed. */
  | 'failed'
  /** A grilling agent asked a question. */
  | 'question'
  | 'approve-spec'
  | 'approve-board'
  /** A ticket with several blockers waits for their PRs to merge. */
  | 'merge'
  /** The QA plan is ready for the human. */
  | 'qa'
  /** A PR review finished; its findings are ready. */
  | 'review'
  /** PR tending could not keep a PR moving on its own. */
  | 'tending'
  /** The review loop of an agent PR stopped; the PR may sit in draft. */
  | 'review-loop'
  /** Startup recovery could not read some work, so the backend cannot tell who owns it. */
  | 'recovery'
  /** The daily retro found a waste pattern that repeats across runs (retro.ts). */
  | 'finding';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  project: string;
  title: string;
  /** What the human should decide or do. */
  action: string;
  /** When the item began to wait. */
  since: string;
  task_id?: string;
  feature_id?: string;
  finding_id?: string;
  ticket?: string;
  pr?: { number: number; url?: string };
  detail?: string;
}

export interface ReviewWaiting {
  number: number;
  title?: string;
  url?: string;
  state: string;
  finished_at?: string;
  decision?: string;
}

export interface TendingWaiting {
  task_id: string;
  number: number;
  url: string;
  reason: string;
  since: string;
}

export interface InboxInput {
  project: string;
  tasks: readonly TaskRecord[];
  features: readonly Feature[];
  reviews?: readonly ReviewWaiting[];
  tending?: readonly TendingWaiting[];
  /** Review loops that stopped, with the reason (same shape as tending stops). */
  reviewLoops?: readonly TendingWaiting[];
  /** The project's findings; only the open ones wait on the human. */
  findings?: readonly RetroFinding[];
}

const firstLine = (text: string, max = 120) => {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
const item = (x: Omit<InboxItem, 'id'>): InboxItem => ({
  id: [x.kind, x.project, x.task_id ?? x.feature_id ?? x.finding_id ?? x.pr?.number, x.ticket, x.since]
    .filter(Boolean)
    .join(':'),
  ...x,
});

/** The items of one project that wait on the human, oldest first. */
export function inboxItems(input: InboxInput): InboxItem[] {
  const { project } = input;
  const out: InboxItem[] = [];
  const featureTasks = new Set(
    input.features.flatMap((f) => f.tickets.map((t) => t.task_id).filter(Boolean)),
  );
  for (const task of input.tasks) {
    const since = task.updated_at ?? task.created_at ?? '';
    const base = { project, task_id: task.id, title: firstLine(task.prompt), since };
    if (task.stage === 'awaiting-approval') {
      const runtime = task.verification?.runtime;
      const notRun = task.verification?.not_run_locally ?? [];
      out.push(
        item({
          ...base,
          kind: 'gate',
          action: 'Review the diff, then approve, ask for a revision or reject',
          ...(runtime && runtime !== 'yes'
            ? { detail: `The runtime check says "${runtime}": check the app by hand.` }
            : notRun.length
              ? { detail: `Not checked locally (${notRun.join(', ')}): CI must pass before merge.` }
              : {}),
        }),
      );
    } else if (task.stage === 'blocked')
      out.push(
        item({
          ...base,
          kind: 'blocked',
          // A comment wakes an agent run; a pipeline run blocked before any code cannot continue.
          action:
            task.workflow === 'agent'
              ? 'Answer the agent in a comment on the task; it continues from there'
              : 'Read the questions, then start a new task that answers them, or cancel this one',
          ...(task.verdict?.blockers?.length
            ? { detail: task.verdict.blockers.map((b) => b.question).join('; ') }
            : {}),
        }),
      );
    // A failed feature ticket shows once, on the feature.
    else if ((task.stage === 'failed' || task.stage === 'verification-failed') && !featureTasks.has(task.id))
      out.push(item({ ...base, kind: 'failed', action: 'Read the log, then run again or reject' }));
  }
  for (const f of input.features) {
    if (f.working || ['done', 'cancelled'].includes(f.stage)) continue;
    const base = { project, feature_id: f.id, title: f.title, since: f.updated_at };
    if (f.error) {
      out.push(
        item({ ...base, kind: 'failed', action: 'Read the error, then retry the step', detail: f.error }),
      );
      continue;
    }
    const last = f.grill.turns.at(-1);
    if (f.stage === 'grilling' && last?.role === 'agent')
      out.push(
        item({
          ...base,
          kind: 'question',
          action: 'Answer the question',
          detail: firstLine(last.text, 400),
          since: last.at,
        }),
      );
    if (f.stage === 'spec' && f.spec)
      out.push(
        item({
          ...base,
          kind: 'approve-spec',
          action: 'Read the spec and its critique, then approve or edit it',
          since: f.spec.written_at,
        }),
      );
    if (f.stage === 'board' && f.tickets.length)
      out.push(
        item({
          ...base,
          kind: 'approve-board',
          action: 'Check the tickets and their blockers, then approve the board',
        }),
      );
    if (f.stage === 'qa' && f.qa)
      out.push(
        item({
          ...base,
          kind: 'qa',
          action: 'Run the QA plan, then complete the feature',
          since: f.qa.written_at,
        }),
      );
    if (f.stage === 'implementing') {
      const byId = new Map(f.tickets.map((t) => [t.id, t]));
      for (const t of f.tickets) {
        if (t.state === 'failed')
          out.push(
            item({
              ...base,
              kind: 'failed',
              ticket: t.id,
              title: `${t.id} ${t.title}`,
              action: 'Read the task log, then retry the ticket',
              ...(t.error ? { detail: t.error } : {}),
              ...(t.task_id ? { task_id: t.task_id } : {}),
            }),
          );
        if (
          t.state === 'waiting' &&
          !t.blockers_merged_at &&
          t.blocked_by.length > 1 &&
          t.blocked_by.every((b) => byId.get(b)?.state === 'done')
        )
          out.push(
            item({
              ...base,
              kind: 'merge',
              ticket: t.id,
              title: `${t.id} ${t.title}`,
              action: `Merge the PRs of ${t.blocked_by.join(', ')}, then mark them merged`,
            }),
          );
      }
    }
  }
  for (const r of input.reviews ?? [])
    if (r.state !== 'running' && r.state !== 'preparing' && r.finished_at)
      out.push(
        item({
          project,
          kind: 'review',
          pr: { number: r.number, ...(r.url ? { url: r.url } : {}) },
          title: r.title ?? `PR #${r.number}`,
          action:
            r.state === 'completed'
              ? 'Read the review, then reply or post it'
              : `The review ${r.state}: start it again`,
          since: r.finished_at,
          ...(r.decision ? { detail: `Decision: ${r.decision}` } : {}),
        }),
      );
  for (const t of input.tending ?? [])
    out.push(
      item({
        project,
        kind: 'tending',
        task_id: t.task_id,
        pr: { number: t.number, url: t.url },
        title: `PR #${t.number}`,
        action: 'Help the PR along: tending stopped',
        detail: t.reason,
        since: t.since,
      }),
    );
  for (const t of input.reviewLoops ?? [])
    out.push(
      item({
        project,
        kind: 'review-loop',
        task_id: t.task_id,
        pr: { number: t.number, url: t.url },
        title: `PR #${t.number}`,
        action: 'Review loop stopped: open the PR and finish it, or push a fix to review it again',
        detail: t.reason,
        since: t.since,
      }),
    );
  for (const f of input.findings ?? [])
    if (f.status === 'open')
      out.push(
        item({
          project,
          kind: 'finding',
          finding_id: f.id,
          title: f.title,
          action: 'Create task',
          detail: `Seen in ${f.occurrences} runs${f.wasted_usd === null ? '' : `, about $${f.wasted_usd.toFixed(2)} wasted`}. A task goes to Backlog; nothing starts by itself.`,
          since: f.first_seen,
        }),
      );
  return out.sort((a, b) => a.since.localeCompare(b.since));
}
