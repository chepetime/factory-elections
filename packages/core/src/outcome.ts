import { z } from 'zod';
import type { SpanRecord } from './trace.ts';

const Fields = z.object({
  kind: z.enum(['merged', 'reverted', 'incident']),
  occurred_at: z.iso.datetime(),
  task_id: z.uuid().optional(),
  pr: z.object({ url: z.url(), number: z.number().int().positive().optional() }).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
});
export const NewOutcome = Fields.refine(
  (value) => value.task_id || value.pr,
  'A task or PR link is required',
);
export const Outcome = Fields.extend({ id: z.uuid() }).refine(
  (value) => value.task_id || value.pr,
  'A task or PR link is required',
);
export type Outcome = z.infer<typeof Outcome>;

/** Link only within the selected project; reject a span that contradicts either provided link. */
export function outcomeTraceIds(outcome: Outcome, project: string, spans: readonly SpanRecord[]): string[] {
  const ids = new Set<string>();
  for (const span of spans) {
    if (span.project !== project) continue;
    if (outcome.task_id && span.task_id && outcome.task_id !== span.task_id) continue;
    if (outcome.pr && span.pr && outcome.pr.url !== span.pr.url) continue;
    if (
      (outcome.task_id && span.task_id === outcome.task_id) ||
      (outcome.pr && span.pr?.url === outcome.pr.url)
    )
      ids.add(span.trace_id);
  }
  return [...ids].sort();
}
