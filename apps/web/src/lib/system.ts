// Data for the Functions and System pages of the rail: the newest tool and model calls, the saved
// review findings, the traffic numbers, and the catalog of MCP servers, tools and skills.
import 'server-only';
import { backendCall } from '@factory/backend-client';
import { SpanRecord } from '@factory/core';
import { z } from 'zod';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
const json = (text: string): unknown => JSON.parse(text);

const SpanList = z.object({
  since: z.string(),
  total: z.number(),
  failed: z.number(),
  items: z.array(SpanRecord.omit({ replay: true })),
});
export type SpanList = z.infer<typeof SpanList>;
export type ListedSpan = SpanList['items'][number];

/** The newest spans of one type over every project, e.g. every tool call. */
export function listSpans(
  type: 'tool' | 'model' | 'review',
  limit = 200,
  scope: { project?: string; days?: number } = {},
): Promise<Result<SpanList>> {
  const query = { type, limit, ...(scope.days ? { days: scope.days } : {}) };
  return attempt(async () =>
    SpanList.parse(
      json(
        (await backendCall('ListSpans', { project: scope.project ?? '', json: JSON.stringify(query) })).json,
      ),
    ),
  );
}

const FindingRow = z.object({
  project: z.string(),
  number: z.number(),
  index: z.number(),
  title: z.string(),
  url: z.string(),
  at: z.string(),
  decision: z.string().optional(),
  severity: z.string().optional(),
  axis: z.string().optional(),
  finding: z.string(),
  file: z.string().optional(),
  line_range: z.string().optional(),
  fix: z.string().optional(),
});
export type FindingRow = z.infer<typeof FindingRow>;

/** Every saved review finding, newest review first. */
export function listFindings(): Promise<Result<FindingRow[]>> {
  return attempt(async () =>
    z.array(FindingRow).parse(json((await backendCall('ListFindings', { project: '', id: '' })).json)),
  );
}

const tokens = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number(),
  cache_write: z.number(),
});
const Sum = z.object({ cost_usd: z.number(), unknown_cost_spans: z.number(), tokens });
const Traffic = z.object({
  from: z.string(),
  to: z.string(),
  total: Sum.extend({ spans: z.number() }),
  days: z.array(Sum.extend({ day: z.string() })),
  by_model: z.record(z.string(), Sum),
  by_project: z.record(z.string(), Sum),
  by_step: z.record(z.string(), Sum),
  by_type: z.record(z.string(), Sum.extend({ spans: z.number() })),
  runs: z.object({ count: z.number(), failed: z.number() }),
  reliability: z.object({
    stalls: z.number(),
    repeat_loops: z.number(),
    failed_tool_calls: z.number(),
    tool_calls: z.number(),
  }),
  prs: z.object({ count: z.number(), cost_usd: z.number() }),
});
export type Traffic = z.infer<typeof Traffic>;

/** Spend, tokens and calls over every project for the last `days` days. */
export function getTraffic(days = 14, now = Date.now()): Promise<Result<Traffic>> {
  const to = new Date(now + 1000).toISOString();
  const from = new Date(now - days * 86_400_000).toISOString();
  return attempt(async () =>
    Traffic.parse(
      json((await backendCall('GetMetrics', { project: '', json: JSON.stringify({ from, to }) })).json),
    ),
  );
}

const Catalog = z.object({
  usage_days: z.number(),
  mcp: z.array(
    z.object({
      name: z.string(),
      transport: z.string(),
      description: z.string(),
      tools: z.array(z.string()),
    }),
  ),
  external_mcp: z.array(z.object({ name: z.string(), url: z.string() })),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      source: z.enum(['factory', 'built-in']),
      when: z.string(),
      calls: z.number(),
      failed: z.number(),
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      owner: z.string(),
      path: z.string(),
      version: z.string().optional(),
    }),
  ),
});
export type SystemCatalog = z.infer<typeof Catalog>;

/** MCP servers, tools and skills the factory gives its agents. */
export function getSystemCatalog(): Promise<Result<SystemCatalog>> {
  return attempt(async () => Catalog.parse(json((await backendCall('GetSystemCatalog', {})).json)));
}

/** Where a span of a task run opens: its trace. Spans outside a task have no page. */
export function spanHref(span: Pick<ListedSpan, 'project' | 'task_id'>): string | undefined {
  return span.task_id ? `/projects/${span.project}/tasks/${span.task_id}/trace` : undefined;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
