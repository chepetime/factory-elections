// Daily waste mining, pure part. Runs and spans of the last 7 days go in; deterministic waste
// signals and at most one finding per day come out. A finding that was filed earlier and has
// merged is measured: the same signal before and after the merge. No model, no I/O; the backend
// job reads the data, files the ticket and posts the comment.
import { MAX_TEND_FIXES } from './tending.ts';
import { REVIEW_LOOP_MAX_FIXES } from './review-loop.ts';
import { runSignals } from './run-signals.ts';
import type { SpanRecord } from './trace.ts';

export const WASTE_WINDOW_DAYS = 7;
/** The job's own spend per day. The backend refuses to run it past this. */
export const WASTE_JOB_DAILY_CAP_USD = 0.5;

export type WasteSignalKind = 'repeated-fix' | 'stopped-tending' | 'review-limit' | 'spend-per-merged-pr';

/** What the job needs to know about one task, read from the board and PR state. */
export interface WasteTask {
  task_id: string;
  project: string;
  /** Agent fixes pushed while tending. */
  tend_fixes: number;
  tending_stopped: boolean;
  /** Fix rounds of the review loop. */
  review_fixes: number;
  pr_merged_at?: string;
  /** Summed span cost of the task; null when a span reported none. */
  cost_usd: number | null;
}

export interface WasteFinding {
  kind: WasteSignalKind;
  /** Dollars of waste in the window. */
  wasted_usd: number;
  /** How many runs or tasks show it. */
  count: number;
  /** Trace ids or task ids that prove it. */
  evidence: string[];
  title: string;
}

const round = (n: number) => Math.round(n * 100) / 100;
const inWindow = (at: string | undefined, from: number, to: number) => {
  const t = at ? Date.parse(at) : NaN;
  return t > from && t <= to;
};

/** Run cost by trace, from the spans; spans without a reported cost add nothing. */
function traceCost(spans: readonly SpanRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of spans) out.set(s.trace_id, (out.get(s.trace_id) ?? 0) + (s.cost_usd ?? 0));
  return out;
}

/** All waste findings of the window, biggest first. Pure and deterministic. */
export function wasteFindings(
  spans: readonly SpanRecord[],
  tasks: readonly WasteTask[],
  now: Date = new Date(),
  windowDays = WASTE_WINDOW_DAYS,
): WasteFinding[] {
  const to = now.getTime();
  const from = to - windowDays * 86_400_000;
  const recent = spans.filter((s) => inWindow(s.ended_at, from, to));
  const cost = traceCost(recent);
  const findings: WasteFinding[] = [];

  const fixes = runSignals(recent).filter((r) => r.fail_fix_loops > 0 || r.repeated_calls > 0);
  if (fixes.length) {
    findings.push({
      kind: 'repeated-fix',
      wasted_usd: round(fixes.reduce((n, r) => n + (r.wasted_usd ?? 0), 0)),
      count: fixes.length,
      evidence: fixes.map((r) => r.trace_id),
      title: `${fixes.length} runs repeated the same fix or call`,
    });
  }

  const live = tasks.filter((t) => t.cost_usd !== null);
  const stopped = live.filter((t) => t.tending_stopped || t.tend_fixes >= MAX_TEND_FIXES);
  if (stopped.length) {
    findings.push({
      kind: 'stopped-tending',
      wasted_usd: round(stopped.reduce((n, t) => n + (t.cost_usd ?? 0), 0)),
      count: stopped.length,
      evidence: stopped.map((t) => t.task_id),
      title: `${stopped.length} PRs stopped tending without going green`,
    });
  }

  const limit = live.filter((t) => t.review_fixes >= REVIEW_LOOP_MAX_FIXES);
  if (limit.length) {
    findings.push({
      kind: 'review-limit',
      wasted_usd: round(limit.reduce((n, t) => n + (t.cost_usd ?? 0), 0)),
      count: limit.length,
      evidence: limit.map((t) => t.task_id),
      title: `${limit.length} review loops reached their fix limit`,
    });
  }

  const merged = live.filter((t) => inWindow(t.pr_merged_at, from, to));
  const totalCost = round([...cost.values()].reduce((n, c) => n + c, 0));
  if (merged.length && totalCost > 0) {
    const perPr = round(totalCost / merged.length);
    findings.push({
      kind: 'spend-per-merged-pr',
      // Only the spend that did not end in a merge counts as waste.
      wasted_usd: round(Math.max(0, totalCost - merged.reduce((n, t) => n + (t.cost_usd ?? 0), 0))),
      count: merged.length,
      evidence: merged.map((t) => t.task_id),
      title: `$${perPr} spent per merged PR (${merged.length} merged)`,
    });
  }

  return findings.filter((f) => f.wasted_usd > 0).sort((a, b) => b.wasted_usd - a.wasted_usd);
}

/** The one finding worth a ticket today, or none when a ticket was already filed today. */
export function pickDailyFinding(
  findings: readonly WasteFinding[],
  filedToday: boolean,
): WasteFinding | undefined {
  return filedToday ? undefined : findings[0];
}

export interface FindingOutcome {
  before: number;
  after: number;
  verdict: 'improved' | 'regressed' | 'unchanged';
}

/** Compares one signal's wasted dollars in equal windows before and after a fix merged. */
export function measureFix(
  spans: readonly SpanRecord[],
  tasks: readonly WasteTask[],
  kind: WasteSignalKind,
  mergedAt: Date,
  windowDays = WASTE_WINDOW_DAYS,
): FindingOutcome {
  const span = windowDays * 86_400_000;
  const waste = (end: number) =>
    wasteFindings(spans, tasks, new Date(end), windowDays).find((f) => f.kind === kind)?.wasted_usd ?? 0;
  const before = waste(mergedAt.getTime());
  const after = waste(mergedAt.getTime() + span);
  const verdict = after < before * 0.9 ? 'improved' : after > before * 1.1 ? 'regressed' : 'unchanged';
  return { before, after, verdict };
}

/** The comment for a measured fix. */
export function outcomeComment(kind: WasteSignalKind, o: FindingOutcome): string {
  return `Measured after merge (${kind}): $${o.before} wasted in the ${WASTE_WINDOW_DAYS} days before, $${o.after} in the ${WASTE_WINDOW_DAYS} days after: ${o.verdict}.`;
}

/** The job may run only while its own spend today stays under its cap. */
export function wasteJobMayRun(spentTodayUsd: number, capUsd = WASTE_JOB_DAILY_CAP_USD): boolean {
  return spentTodayUsd < capUsd;
}
