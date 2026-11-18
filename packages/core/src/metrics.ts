// Counts across runs, from the span ledger alone. Pure: the backend reads the spans, this module
// turns them into a trace tree and a metrics summary (the Weekly page).
//
// Cost rules follow the ledger: each span's cost is its own, so sums add every span; a span with
// `cost_usd: null` is counted in `unknown_cost_spans`, never as $0.
import type { SpanRecord, SpanTokens } from './trace.ts';

export interface CostSum {
  cost_usd: number;
  /** Spans whose provider reported no cost: the sum is a lower bound when this is above 0. */
  unknown_cost_spans: number;
  tokens: Required<SpanTokens>;
}

const emptySum = (): CostSum => ({
  cost_usd: 0,
  unknown_cost_spans: 0,
  tokens: { input: 0, output: 0, cache_read: 0 },
});

function addSpan(sum: CostSum, span: SpanRecord): void {
  if (span.cost_usd === null) sum.unknown_cost_spans++;
  else if (typeof span.cost_usd === 'number') sum.cost_usd += span.cost_usd;
  if (span.tokens) {
    sum.tokens.input += span.tokens.input;
    sum.tokens.output += span.tokens.output;
    sum.tokens.cache_read += span.tokens.cache_read ?? 0;
  }
}

function addSum(sum: CostSum, other: CostSum): void {
  sum.cost_usd += other.cost_usd;
  sum.unknown_cost_spans += other.unknown_cost_spans;
  sum.tokens.input += other.tokens.input;
  sum.tokens.output += other.tokens.output;
  sum.tokens.cache_read += other.tokens.cache_read;
}

export interface TraceNode {
  span: SpanRecord;
  children: TraceNode[];
  /** The span and everything under it. */
  total: CostSum;
}

/** Spans as trees: a span whose parent is not in the list is a root. Children in start order. */
export function traceTree(spans: readonly SpanRecord[]): TraceNode[] {
  const nodes = new Map(
    spans.map((s) => [s.span_id, { span: s, children: [], total: emptySum() } as TraceNode]),
  );
  const roots: TraceNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.span.parent_span_id ? nodes.get(node.span.parent_span_id) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const roll = (node: TraceNode): CostSum => {
    node.children.sort((a, b) => a.span.started_at.localeCompare(b.span.started_at));
    addSpan(node.total, node.span);
    for (const child of node.children) addSum(node.total, roll(child));
    return node.total;
  };
  for (const root of roots) roll(root);
  return roots.sort((a, b) => a.span.started_at.localeCompare(b.span.started_at));
}

export function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const rate = (part: number, whole: number) => (whole ? part / whole : undefined);

/** Task stages at which a run's work passed its checks and reached the human. */
const PASSED_STAGES = new Set(['awaiting-approval', 'approved', 'pr-opened']);
/** Steps that write code: their model changes are the escalation ladder. */
const CODER_STEPS = new Set(['coder']);

export interface Grade {
  task_class: string;
  /** The model the first coder call of the run used. */
  first_model: string;
  runs: number;
  /** Runs that passed with one coder call. */
  first_pass: number;
  /** Runs that moved to another model. */
  climbed: number;
  cost_usd: number;
  /**
   * `right`: passes first time at least 80% of runs. `too-weak`: climbs in more than 30%.
   * `try-cheaper`: always passes first time over 5+ runs, so a cheaper first model may do.
   * `too-few`: fewer than 3 runs. `mixed`: none of these.
   */
  grade: 'right' | 'too-weak' | 'try-cheaper' | 'too-few' | 'mixed';
}

export interface MetricsSummary {
  from: string;
  to: string;
  total: CostSum & { spans: number; cache_hit_rate?: number };
  days: (CostSum & { day: string; by_provider: Record<string, number> })[];
  by_provider: Record<string, CostSum>;
  by_model: Record<string, CostSum>;
  by_type: Record<string, CostSum & { spans: number }>;
  by_step: Record<string, CostSum>;
  by_project: Record<string, CostSum>;
  by_feature: Record<string, CostSum>;
  runs: {
    count: number;
    failed: number;
    failure_rate?: number;
    /** Runs that reached the human with one coder call. */
    first_pass_rate?: number;
    /** Runs whose coder calls used more than one model. */
    climb_rate?: number;
    median_duration_ms?: number;
  };
  reliability: {
    /** Model and child calls stopped for silence. */
    stalls: number;
    /** Loop-guard judgements that found the agent stuck. */
    repeat_loops: number;
    failed_tool_calls: number;
    tool_calls: number;
  };
  /** Tasks with a PR: their whole cost and the agent time of their runs. */
  prs: { count: number; median_cost_usd?: number; median_run_ms?: number; cost_usd: number };
  gates: { count: number; median_wait_ms?: number; total_wait_ms: number };
  reviews: CostSum & { turns: number };
  call_grading: Grade[];
}

function bucket<K extends string>(map: Record<K, CostSum>, key: K | undefined, span: SpanRecord): void {
  if (!key) return;
  addSpan((map[key] ??= emptySum()), span);
}

/** The metrics of every span that ended in `[from, to)`. */
export function metricsSummary(spans: readonly SpanRecord[], from: string, to: string): MetricsSummary {
  const inRange = spans.filter((s) => s.ended_at >= from && s.ended_at < to);
  const total = { ...emptySum(), spans: inRange.length } as MetricsSummary['total'];
  const days = new Map<string, MetricsSummary['days'][number]>();
  const summary: MetricsSummary = {
    from,
    to,
    total,
    days: [],
    by_provider: {},
    by_model: {},
    by_type: {},
    by_step: {},
    by_project: {},
    by_feature: {},
    runs: { count: 0, failed: 0 },
    reliability: { stalls: 0, repeat_loops: 0, failed_tool_calls: 0, tool_calls: 0 },
    prs: { count: 0, cost_usd: 0 },
    gates: { count: 0, total_wait_ms: 0 },
    reviews: { ...emptySum(), turns: 0 },
    call_grading: [],
  };
  const byTrace = new Map<string, SpanRecord[]>();
  for (const span of inRange) {
    addSpan(total, span);
    const day = span.ended_at.slice(0, 10);
    let d = days.get(day);
    if (!d) days.set(day, (d = { ...emptySum(), day, by_provider: {} }));
    addSpan(d, span);
    if (span.provider && typeof span.cost_usd === 'number')
      d.by_provider[span.provider] = (d.by_provider[span.provider] ?? 0) + span.cost_usd;
    bucket(summary.by_provider, span.provider, span);
    bucket(summary.by_model, span.model, span);
    bucket(summary.by_step, span.step, span);
    bucket(summary.by_project, span.project, span);
    bucket(summary.by_feature, span.feature_id, span);
    const type = (summary.by_type[span.type] ??= { ...emptySum(), spans: 0 });
    type.spans++;
    addSpan(type, span);
    if ((span.type === 'model' || span.type === 'child') && /stall/i.test(span.error ?? ''))
      summary.reliability.stalls++;
    if (span.type === 'loop-judge' && span.attributes?.stuck === true) summary.reliability.repeat_loops++;
    if (span.type === 'tool') {
      summary.reliability.tool_calls++;
      if (span.outcome === 'failed') summary.reliability.failed_tool_calls++;
    }
    if (span.type === 'gate') {
      summary.gates.count++;
      summary.gates.total_wait_ms += span.duration_ms ?? 0;
    }
    if (span.type === 'review') {
      summary.reviews.turns++;
      addSpan(summary.reviews, span);
    }
    const list = byTrace.get(span.trace_id);
    if (list) list.push(span);
    else byTrace.set(span.trace_id, [span]);
  }
  total.cache_hit_rate = rate(total.tokens.cache_read, total.tokens.input);
  summary.days = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  summary.gates.median_wait_ms = median(
    inRange.filter((s) => s.type === 'gate').map((s) => s.duration_ms ?? 0),
  );

  // Runs: the root span of each task trace, with the coder calls under it.
  const durations: number[] = [];
  let firstPass = 0;
  let climbed = 0;
  let coded = 0;
  const grades = new Map<string, Grade>();
  for (const run of inRange.filter((s) => s.type === 'run')) {
    summary.runs.count++;
    if (run.outcome !== 'completed') summary.runs.failed++;
    if (run.duration_ms !== undefined) durations.push(run.duration_ms);
    const coders = (byTrace.get(run.trace_id) ?? [])
      .filter((s) => s.type === 'model' && CODER_STEPS.has(s.step ?? ''))
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    if (!coders.length) continue;
    coded++;
    const passed = run.outcome === 'completed' && PASSED_STAGES.has(String(run.attributes?.stage ?? ''));
    const first = passed && coders.length === 1;
    const climb = new Set(coders.map((c) => c.model)).size > 1;
    if (first) firstPass++;
    if (climb) climbed++;
    const cls = run.task_class ?? 'unclassified';
    const key = `${cls}\u0000${coders[0]!.model}`;
    let g = grades.get(key);
    if (!g)
      grades.set(
        key,
        (g = {
          task_class: cls,
          first_model: coders[0]!.model ?? 'unknown',
          runs: 0,
          first_pass: 0,
          climbed: 0,
          cost_usd: 0,
          grade: 'too-few',
        }),
      );
    g.runs++;
    if (first) g.first_pass++;
    if (climb) g.climbed++;
    for (const s of byTrace.get(run.trace_id) ?? []) g.cost_usd += s.cost_usd ?? 0;
  }
  summary.runs.failure_rate = rate(summary.runs.failed, summary.runs.count);
  summary.runs.first_pass_rate = rate(firstPass, coded);
  summary.runs.climb_rate = rate(climbed, coded);
  summary.runs.median_duration_ms = median(durations);
  summary.call_grading = [...grades.values()]
    .map((g) => ({
      ...g,
      grade:
        g.runs < 3
          ? 'too-few'
          : g.climbed / g.runs > 0.3
            ? 'too-weak'
            : g.first_pass === g.runs && g.runs >= 5
              ? 'try-cheaper'
              : g.first_pass / g.runs >= 0.8
                ? 'right'
                : 'mixed',
    }))
    .sort((a, b) => a.task_class.localeCompare(b.task_class) || b.runs - a.runs) as Grade[];

  // PRs: every span of a task that has a PR, across all of its traces in the range.
  const prTasks = new Map<string, { cost: number; runMs: number }>();
  for (const span of inRange) if (span.pr && span.task_id) prTasks.set(span.task_id, { cost: 0, runMs: 0 });
  for (const span of inRange) {
    const t = span.task_id ? prTasks.get(span.task_id) : undefined;
    if (!t) continue;
    t.cost += span.cost_usd ?? 0;
    if (span.type === 'run') t.runMs += span.duration_ms ?? 0;
  }
  summary.prs.count = prTasks.size;
  summary.prs.cost_usd = [...prTasks.values()].reduce((sum, t) => sum + t.cost, 0);
  summary.prs.median_cost_usd = median([...prTasks.values()].map((t) => t.cost));
  summary.prs.median_run_ms = median([...prTasks.values()].map((t) => t.runMs));
  return summary;
}
