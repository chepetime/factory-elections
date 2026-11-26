// Data for the Functions and System pages of the rail: the newest tool and model calls, the saved
// review findings, the traffic numbers, and the catalog of MCP servers, tools and skills.
import 'server-only';
import { backendCall } from '@factory/backend-client';
import { MetricsSummarySchema, SpanRecord } from '@factory/core';
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

/** GetMetrics over every project; the shape is core's (MetricsSummarySchema). */
const Traffic = MetricsSummarySchema;
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
/** With `project`: tool calls and repo skills of that project only. */
export function getSystemCatalog(project?: string): Promise<Result<SystemCatalog>> {
  return attempt(async () =>
    Catalog.parse(json((await backendCall('GetSystemCatalog', { project: project ?? '' })).json)),
  );
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

export interface ModelUsage {
  provider: string;
  model: string;
  calls: number;
  failed: number;
  /** Null when no call reported a cost. */
  cost: number | null;
  input: number;
  output: number;
}

/** Model spans grouped by provider and model, busiest first. */
export function modelUsage(
  spans: Pick<ListedSpan, 'provider' | 'model' | 'outcome' | 'cost_usd' | 'tokens'>[],
): ModelUsage[] {
  const rows = new Map<string, ModelUsage>();
  for (const span of spans) {
    const provider = span.provider ?? 'unknown';
    const model = span.model ?? 'unknown';
    const key = `${provider}\u0000${model}`;
    const row = rows.get(key) ?? { provider, model, calls: 0, failed: 0, cost: null, input: 0, output: 0 };
    row.calls++;
    if (span.outcome !== 'completed') row.failed++;
    if (typeof span.cost_usd === 'number') row.cost = (row.cost ?? 0) + span.cost_usd;
    row.input += span.tokens?.input ?? 0;
    row.output += span.tokens?.output ?? 0;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));
}
