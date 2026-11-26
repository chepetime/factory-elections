import 'server-only';
import { backendCall } from '@factory/backend-client';
import { z } from 'zod';
const tokens = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number(),
  cache_write: z.number(),
});
const cost = z.object({ cost_usd: z.number(), unknown_cost_spans: z.number(), tokens });
const Metrics = z.object({
  from: z.string(),
  to: z.string(),
  total: cost,
  days: z.array(cost.extend({ day: z.string() })),
  prs: z.object({
    count: z.number(),
    median_cost_usd: z.number().optional(),
    median_run_ms: z.number().optional(),
  }),
  runs: z.object({
    count: z.number(),
    failed: z.number(),
    failure_rate: z.number().optional(),
    first_pass_rate: z.number().optional(),
    climb_rate: z.number().optional(),
  }),
  reliability: z.object({
    stalls: z.number(),
    repeat_loops: z.number(),
    failed_tool_calls: z.number(),
    tool_calls: z.number(),
  }),
  call_grading: z.array(
    z.object({
      task_class: z.string(),
      first_model: z.string(),
      runs: z.number(),
      first_pass: z.number(),
      climbed: z.number(),
      cost_usd: z.number(),
      grade: z.string(),
    }),
  ),
});
export async function getWeekly(project: string) {
  return Metrics.parse(JSON.parse((await backendCall('GetMetrics', { project, json: '{}' })).json));
}
