// Daily spend spikes per (project, step, model), found from the span ledger with no model call.
// A spike: cost per run >= 1.5x the trailing 14-day median on two days in a row, or >= 2x on the
// latest day, while the run volume stays within 25% of its median (more runs is not a spike).
import type { InboxItem } from './inbox.ts';
import type { SpanRecord } from './trace.ts';

const DAY_MS = 86_400_000;
export const SPIKE_WINDOW_DAYS = 14;
export const SPIKE_ONE_DAY = 2;
export const SPIKE_TWO_DAYS = 1.5;
export const SPIKE_VOLUME_TOLERANCE = 0.25;
const MIN_BASELINE_DAYS = 3;
const TOP_RUNS = 3;

export interface SpendSpike {
  project: string;
  step: string;
  model: string;
  /** The latest complete UTC day, `YYYY-MM-DD`. */
  day: string;
  cost_per_run: number;
  baseline_cost_per_run: number;
  ratio: number;
  runs: number;
  baseline_runs: number;
  /** `one-day` (>= 2x) or `two-days` (>= 1.5x on both of the last two days). */
  rule: 'one-day' | 'two-days';
  top_runs: { trace_id: string; cost_usd: number }[];
}

interface Day {
  cost: number;
  runs: Map<string, number>;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Spikes on the last complete UTC day before `now`, one per (project, step, model). */
export function detectSpendSpikes(spans: readonly SpanRecord[], now: Date = new Date()): SpendSpike[] {
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const groups = new Map<string, Map<string, Day>>();
  for (const s of spans) {
    if (s.type !== 'model' || s.cost_usd == null || !s.step || !s.model) continue;
    const key = JSON.stringify([s.project, s.step, s.model]);
    const days = groups.get(key) ?? new Map<string, Day>();
    groups.set(key, days);
    const day = days.get(s.ended_at.slice(0, 10)) ?? { cost: 0, runs: new Map() };
    days.set(s.ended_at.slice(0, 10), day);
    day.cost += s.cost_usd;
    day.runs.set(s.trace_id, (day.runs.get(s.trace_id) ?? 0) + s.cost_usd);
  }
  const out: SpendSpike[] = [];
  for (const [key, days] of groups) {
    const [project, step, model] = JSON.parse(key) as [string, string, string];
    // Cost per run and volume of one day against the 14 days before it.
    const judge = (at: number) => {
      const d = days.get(dayKey(at));
      const prior = Array.from({ length: SPIKE_WINDOW_DAYS }, (_, i) =>
        days.get(dayKey(at - (i + 1) * DAY_MS)),
      ).filter((x): x is Day => !!x && x.runs.size > 0);
      if (!d || d.runs.size === 0 || prior.length < MIN_BASELINE_DAYS) return undefined;
      const base = median(prior.map((x) => x.cost / x.runs.size));
      const baseRuns = median(prior.map((x) => x.runs.size));
      return {
        d,
        base,
        baseRuns,
        perRun: d.cost / d.runs.size,
        ratio: base > 0 ? d.cost / d.runs.size / base : 0,
      };
    };
    const latest = judge(today - DAY_MS);
    if (!latest) continue;
    const previous = judge(today - 2 * DAY_MS);
    const rule =
      latest.ratio >= SPIKE_ONE_DAY
        ? 'one-day'
        : latest.ratio >= SPIKE_TWO_DAYS && previous && previous.ratio >= SPIKE_TWO_DAYS
          ? 'two-days'
          : undefined;
    if (!rule) continue;
    if (Math.abs(latest.d.runs.size - latest.baseRuns) > latest.baseRuns * SPIKE_VOLUME_TOLERANCE) continue;
    out.push({
      project,
      step,
      model,
      day: dayKey(today - DAY_MS),
      cost_per_run: latest.perRun,
      baseline_cost_per_run: latest.base,
      ratio: latest.ratio,
      runs: latest.d.runs.size,
      baseline_runs: latest.baseRuns,
      rule,
      top_runs: [...latest.d.runs]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_RUNS)
        .map(([trace_id, cost_usd]) => ({ trace_id, cost_usd })),
    });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

/** One inbox item per spike; its id holds the day, so a dismissal ends with that day. */
export function spendSpikeInboxItem(spike: SpendSpike): InboxItem {
  return {
    id: ['spend-spike', spike.project, spike.step, spike.model, spike.day].join(':'),
    kind: 'spend-spike',
    project: spike.project,
    title: `Spend spike: ${spike.step} on ${spike.model}`,
    action: 'Look at the costliest runs, then fix the step or change its model',
    since: `${spike.day}T00:00:00.000Z`,
    detail: `$${spike.cost_per_run.toFixed(2)} per run on ${spike.day}, ${spike.ratio.toFixed(1)}x the 14-day median of $${spike.baseline_cost_per_run.toFixed(2)} (${spike.runs} runs, usually ${spike.baseline_runs}). Top runs: ${spike.top_runs.map((r) => `${r.trace_id} $${r.cost_usd.toFixed(2)}`).join(', ')}.`,
  };
}
