// The GetMetrics response as a zod schema, so callers (the web app) parse it with the same shape
// the backend builds, instead of copying it. The type checks below keep it equal to MetricsSummary.
import { z } from 'zod';
import type { MetricsSummary } from './metrics.ts';

const Tokens = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number(),
  cache_write: z.number(),
});
const CostSum = z.object({ cost_usd: z.number(), unknown_cost_spans: z.number(), tokens: Tokens });
const opt = z.number().optional();
const RunSignalsSchema = z.object({
  trace_id: z.string(),
  project: z.string(),
  task_id: z.string().optional(),
  task_class: z.string().optional(),
  source: z.string().optional(),
  pattern: z
    .object({
      kind: z.enum(['fail-fix', 'repeat', 'oscillation', 'churn', 'failure-streak']),
      tool: z.string(),
      shape: z.string(),
    })
    .optional(),
  tool_calls: z.number(),
  edit_churn: z.number(),
  repeated_calls: z.number(),
  oscillations: z.number(),
  fail_fix_loops: z.number(),
  max_failure_streak: z.number(),
  empty_answers: z.number(),
  wasted_calls: z.number(),
  waste_ratio: z.number(),
  wasted_usd: z.number().nullable(),
  wasted_tokens: z.number(),
  category: z.enum(['thrash', 'errors', 'failed', 'fine']),
});

export const MetricsSummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  total: CostSum.extend({ spans: z.number(), cache_hit_rate: opt }),
  days: z.array(CostSum.extend({ day: z.string(), by_provider: z.record(z.string(), z.number()) })),
  by_provider: z.record(z.string(), CostSum),
  by_model: z.record(z.string(), CostSum),
  by_type: z.record(z.string(), CostSum.extend({ spans: z.number() })),
  by_step: z.record(z.string(), CostSum.extend({ cache_hit_rate: opt })),
  by_project: z.record(z.string(), CostSum),
  by_feature: z.record(z.string(), CostSum),
  runs: z.object({
    count: z.number(),
    failed: z.number(),
    failure_rate: opt,
    first_pass_rate: opt,
    climb_rate: opt,
    median_duration_ms: opt,
    clean_rate: opt,
    waste: z.array(RunSignalsSchema).default([]),
    unusual: z.array(
      z.object({
        trace_id: z.string(),
        project: z.string(),
        task_id: z.string().optional(),
        task_class: z.string(),
        cost_usd: z.number(),
        threshold_usd: z.number(),
        baseline_runs: z.number(),
      }),
    ),
  }),
  reliability: z.object({
    stalls: z.number(),
    repeat_loops: z.number(),
    failed_tool_calls: z.number(),
    tool_calls: z.number(),
  }),
  prs: z.object({ count: z.number(), median_cost_usd: opt, median_run_ms: opt, cost_usd: z.number() }),
  gates: z.object({ count: z.number(), median_wait_ms: opt, total_wait_ms: z.number() }),
  reviews: CostSum.extend({ turns: z.number() }),
  call_grading: z.array(
    z.object({
      task_class: z.string(),
      first_model: z.string(),
      runs: z.number(),
      first_pass: z.number(),
      climbed: z.number(),
      cost_usd: z.number(),
      grade: z.enum(['right', 'too-weak', 'try-cheaper', 'too-few', 'mixed']),
    }),
  ),
});

// Fails to compile when the schema and MetricsSummary drift apart, in either direction.
type Parsed = z.infer<typeof MetricsSummarySchema>;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const METRICS_SCHEMA_MATCHES: Same<Parsed, MetricsSummary> = true;
