// The whole life of a ticket on one vertical line: what people and agents did on the ticket (its
// events) and what each run did (start, models, checks, approval, PR, end). Pure: the task page
// passes the issue and its run records in.
import { stageLabel, type TaskRecord } from '@factory/core';

export type TimelineKind =
  | 'created'
  | 'status'
  | 'edit'
  | 'agent'
  | 'run'
  | 'check'
  | 'approval'
  | 'pr'
  | 'follow-up'
  | 'review'
  | 'note';

/** One model's work in one step of a run: `claude-sonnet-5-5` as `coder`, 3 calls. */
export interface ModelUse {
  model: string;
  step: string;
  calls: number;
  failed: number;
  /** Null when a call reported no cost: the sum would be a lower bound. */
  cost_usd: number | null;
}

export interface TimelineEntry {
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  tone?: 'good' | 'bad';
  href?: string;
  models?: ModelUse[];
}

/** Every model that worked the ticket, over all runs. */
export interface ModelTotal {
  model: string;
  calls: number;
  failed: number;
  cost_usd: number | null;
  steps: string[];
  runs: number;
}

interface IssueInput {
  created_at: string;
  events: { at: string; kind: string; message: string }[];
  runs: string[];
}

type Run = Pick<
  TaskRecord,
  | 'created_at'
  | 'updated_at'
  | 'stage'
  | 'attempts'
  | 'verification'
  | 'approval'
  | 'pr'
  | 'workflow'
  | 'agent'
>;

const ENDED = new Set(['failed', 'rejected', 'cancelled']);
/** Edits this close together read as one change. */
const EDIT_GAP_MS = 5 * 60_000;
/** The issue event a run's start entry already says. */
const RUN_START = 'Started a run';
/** The issue event for another turn of the same run, e.g. after a follow-up. */
const RAN_AGAIN = 'Ran again';

const addCost = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);

function modelUses(attempts: NonNullable<Run['attempts']>): ModelUse[] {
  const uses = new Map<string, ModelUse>();
  for (const a of attempts) {
    const key = `${a.model}\u0000${a.step}`;
    const use = uses.get(key) ?? { model: a.model, step: a.step, calls: 0, failed: 0, cost_usd: 0 };
    use.calls++;
    if (a.outcome === 'failed') use.failed++;
    use.cost_usd = addCost(use.cost_usd, a.cost_usd);
    uses.set(key, use);
  }
  return [...uses.values()];
}

const field = (kind: string) => kind.slice('edit:'.length).replace(/_/g, ' ');
function joinFields(fields: string[]): string {
  const unique = [...new Set(fields)];
  return unique.length === 1 ? unique[0]! : `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`;
}

/** One senior PR review turn on a PR of this ticket, from its `review` span. */
export interface ReviewTurn {
  at: string;
  name: string;
  /** The turn's index in its review chat: 0 is the review itself, later ones are replies. */
  turn?: number;
  model?: string;
  outcome: string;
  cost_usd?: number | null;
  pr?: { number?: number };
}

const reviewUse = (t: ReviewTurn): ModelUse => ({
  model: t.model ?? 'unknown model',
  step: 'review',
  calls: 1,
  failed: t.outcome === 'completed' ? 0 : 1,
  cost_usd: t.cost_usd ?? null,
});

export function ticketTimeline(
  issue: IssueInput,
  records: (Run | undefined)[],
  names: { creator?: string; agent: (id?: string) => string | undefined },
  reviews: readonly ReviewTurn[] = [],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const hasRuns = records.some(Boolean);
  let edits: { at: string; fields: string[] } | undefined;
  const flushEdits = () => {
    if (!edits) return;
    entries.push({ at: edits.at, kind: 'edit', title: `Edited the ${joinFields(edits.fields)}` });
    edits = undefined;
  };

  for (const e of issue.events) {
    if (e.kind.startsWith('edit:') && e.kind !== 'edit:assignee') {
      if (edits && Date.parse(e.at) - Date.parse(edits.at) <= EDIT_GAP_MS) edits.fields.push(field(e.kind));
      else {
        flushEdits();
        edits = { at: e.at, fields: [field(e.kind)] };
      }
      continue;
    }
    flushEdits();
    if (e.kind === 'created') {
      entries.push({
        at: e.at,
        kind: 'created',
        title: 'Created',
        ...(names.creator ? { detail: `by ${names.creator}` } : {}),
      });
    } else if (e.kind.startsWith('move:')) {
      if (hasRuns && e.message === RUN_START) continue;
      entries.push(
        e.message === RAN_AGAIN
          ? { at: e.at, kind: 'run', title: 'Ran again' }
          : { at: e.at, kind: 'status', title: e.message },
      );
    } else if (e.kind === 'edit:assignee' || e.kind === 'route') {
      entries.push({ at: e.at, kind: 'agent', title: e.message });
    } else if (e.kind === 'follow-up') {
      entries.push({ at: e.at, kind: 'follow-up', title: 'Follow-up added', detail: e.message });
    } else if (e.kind === 'review-loop') {
      entries.push({
        at: e.at,
        kind: 'review',
        title: e.message,
        ...(/stopped/i.test(e.message) ? { tone: 'bad' as const } : {}),
      });
    } else if (e.kind !== 'comment') {
      entries.push({ at: e.at, kind: 'note', title: e.message || e.kind });
    }
  }
  flushEdits();

  records.forEach((r, i) => {
    if (!r?.created_at) return;
    const n = i + 1;
    const who = r.workflow === 'agent' ? names.agent(r.agent) : 'Pipeline';
    const start: TimelineEntry = {
      at: r.created_at,
      kind: 'run',
      title: `Run ${n} started`,
      ...(who ? { detail: who } : {}),
    };
    entries.push(start);
    // Each model call belongs to the turn it ran in: the run's start, or a later "Ran again".
    const next = records.slice(i + 1).find((x) => x?.created_at)?.created_at;
    const turns = [
      start,
      ...entries.filter((e) => e.title === RAN_AGAIN && e.at > r.created_at! && (!next || e.at < next)),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const byTurn = new Map<TimelineEntry, NonNullable<Run['attempts']>>();
    for (const a of r.attempts ?? []) {
      const turn = turns.filter((t) => t.at <= a.started_at).at(-1) ?? start;
      byTurn.set(turn, [...(byTurn.get(turn) ?? []), a]);
    }
    for (const [turn, attempts] of byTurn) turn.models = modelUses(attempts);
    if (r.verification)
      entries.push({
        at: r.verification.at,
        kind: 'check',
        title: r.verification.passed ? 'Checks passed' : 'Checks failed',
        tone: r.verification.passed ? 'good' : 'bad',
      });
    if (r.approval)
      entries.push({
        at: r.approval.at,
        kind: 'approval',
        title: r.approval.decision === 'approved' ? 'You approved the change' : 'You rejected the change',
        tone: r.approval.decision === 'approved' ? 'good' : 'bad',
      });
    if (r.pr) {
      const number = /\/pull\/(\d+)/.exec(r.pr.url)?.[1];
      entries.push({
        at: r.pr.at,
        kind: 'pr',
        title: number ? `PR #${number} opened` : 'PR opened',
        href: r.pr.url,
      });
    }
    if (ENDED.has(r.stage) && r.updated_at)
      entries.push({ at: r.updated_at, kind: 'run', title: `Run ${n}: ${stageLabel(r.stage)}`, tone: 'bad' });
  });

  for (const t of reviews)
    entries.push({
      at: t.at,
      kind: 'review',
      title:
        (t.turn ?? (/^review$/i.test(t.name) ? 0 : 1)) === 0 ? 'Senior PR review' : 'Senior PR review reply',
      ...(t.pr?.number ? { detail: `PR #${t.pr.number}` } : {}),
      ...(t.outcome === 'completed' ? {} : { tone: 'bad' as const }),
      models: [reviewUse(t)],
    });

  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

/** The models that worked the ticket, the most calls first. */
export function modelTotals(records: (Run | undefined)[], reviews: readonly ReviewTurn[] = []): ModelTotal[] {
  const totals = new Map<string, ModelTotal & { runSet: Set<number> }>();
  // Review turns count as one more "run" of their own (index -1), so they add no task run.
  const groups: { uses: ModelUse[]; run?: number }[] = [
    ...records.map((r, i) => ({ uses: modelUses(r?.attempts ?? []), run: i })),
    { uses: reviews.map(reviewUse) },
  ];
  groups.forEach(({ uses, run }) => {
    for (const use of uses) {
      const t = totals.get(use.model) ?? {
        model: use.model,
        calls: 0,
        failed: 0,
        cost_usd: 0,
        steps: [],
        runs: 0,
        runSet: new Set<number>(),
      };
      t.calls += use.calls;
      t.failed += use.failed;
      t.cost_usd = addCost(t.cost_usd, use.cost_usd);
      if (!t.steps.includes(use.step)) t.steps.push(use.step);
      if (run !== undefined) t.runSet.add(run);
      totals.set(use.model, t);
    }
  });
  return [...totals.values()]
    .map(({ runSet, ...t }) => ({ ...t, runs: runSet.size }))
    .sort((a, b) => b.calls - a.calls);
}
