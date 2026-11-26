import 'server-only';
import { backendCall } from '@factory/backend-client';
import { SpanRecord, type TraceNode } from '@factory/core';
import { z } from 'zod';

const Cost = z.object({
  cost_usd: z.number(),
  unknown_cost_spans: z.number(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    cache_read: z.number(),
    cache_write: z.number(),
  }),
});
const Node: z.ZodType<TraceNode> = z.lazy(() =>
  z.object({ span: SpanRecord, children: z.array(Node), total: Cost }),
);
const Trace = z.object({ spans: z.number(), roots: z.array(Node) });
export async function getTaskTrace(project: string, id: string) {
  return Trace.parse(
    JSON.parse((await backendCall('GetTrace', { project, json: JSON.stringify({ task_id: id }) })).json),
  );
}
