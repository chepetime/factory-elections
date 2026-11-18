// The span ledger: one append-only JSONL log per project and month, the plain log the metrics store
// rebuilds from. With Postgres and S3 configured, each line goes to S3 and its record to
// `factory_trace_events` (kind `span`), so the same spans can be counted with SQL.
//
// Spans hold no prompts, model output or file contents: names, ids, times, tokens and costs, and a
// short tool input summary (a command or a path).
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactWriter, DataStorage } from '@factory/adapters-data';
import {
  newSpanId,
  providerOf,
  spanTokens,
  SpanRecord,
  ToolSpans,
  type AgentEvent,
  type ModelResult,
  type ModelRun,
  type ModelRunner,
  type SpanType,
  type TraceFields,
  type TraceScope,
} from '@factory/core';

export interface SpanFilter {
  trace_id?: string;
  task_id?: string;
  feature_id?: string;
  /** Spans that ended at or after this ISO time. */
  since?: string;
}

type SpanBody = Omit<SpanRecord, keyof TraceFields | 'parent_span_id' | 'span_id'> & {
  span_id?: string;
  parent_span_id?: string;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 2000);
const errorCost = (error: unknown): number | null =>
  typeof (error as { costUsd?: unknown })?.costUsd === 'number'
    ? (error as { costUsd: number }).costUsd
    : null;
const aborted = (error: unknown) =>
  (error as { reason?: unknown })?.reason === 'aborted' || (error as Error)?.name === 'AbortError';

export class TraceLog {
  private readonly writers = new Map<string, ArtifactWriter>();
  private chain: Promise<unknown> = Promise.resolve();
  /** The model-call span that holds each live delegate grant, so children hang under it. */
  private readonly grantParents = new Map<string, TraceScope>();
  private readonly root: string;
  private readonly storage?: DataStorage;
  private readonly onError: (error: unknown) => void;
  private writeErrors = 0;
  constructor(
    root: string,
    storage?: DataStorage,
    onError: (error: unknown) => void = (error) =>
      process.stderr.write(`Trace write failed: ${errorText(error)}\n`),
  ) {
    this.root = root;
    this.storage = storage;
    this.onError = (error) => {
      this.writeErrors++;
      onError(error);
    };
  }

  private path(project: string, at: string): string {
    return join(this.root, project, 'trace', `spans-${at.slice(0, 7)}.jsonl`);
  }

  /** Appends spans. Never throws: a trace failure must not fail the work it traces. */
  append(scope: TraceScope, ...bodies: SpanBody[]): SpanRecord[] {
    const spans: SpanRecord[] = [];
    for (const body of bodies) {
      const parsed = SpanRecord.safeParse({
        trace_id: scope.trace_id,
        project: scope.project,
        ...(scope.task_id ? { task_id: scope.task_id } : {}),
        ...(scope.feature_id ? { feature_id: scope.feature_id } : {}),
        ...(scope.ticket ? { ticket: scope.ticket } : {}),
        ...(scope.pr ? { pr: scope.pr } : {}),
        ...(scope.task_class ? { task_class: scope.task_class } : {}),
        ...(scope.parent_span_id ? { parent_span_id: scope.parent_span_id } : {}),
        span_id: newSpanId(),
        ...body,
      });
      if (!parsed.success) {
        this.onError(new Error(`invalid span ${body.name}: ${parsed.error.message}`));
        continue;
      }
      spans.push(parsed.data);
    }
    if (spans.length) this.chain = this.chain.then(() => this.write(spans)).catch(this.onError);
    return spans;
  }

  private async write(spans: SpanRecord[]): Promise<void> {
    for (const span of spans) {
      const path = this.path(span.project, span.ended_at);
      const line = `${JSON.stringify(span)}\n`;
      if (this.storage?.config) {
        let writer = this.writers.get(path);
        if (!writer) this.writers.set(path, (writer = this.storage.writer(path)));
        writer.append(line, { kind: 'span', run_id: span.trace_id, ...span });
      } else {
        await mkdir(join(this.root, span.project, 'trace'), { recursive: true });
        await appendFile(path, line, { mode: 0o600 });
      }
    }
  }

  async flush(): Promise<void> {
    await this.chain;
    await Promise.all([...this.writers.values()].map((w) => w.flush().catch(this.onError)));
  }

  /** Ledger health across registered projects. Write errors count failures since startup. */
  async health(
    projects: string[],
  ): Promise<{ unknown_cost_spans: number; missing_parent_links: number; write_errors: number }> {
    const spans = (await Promise.all(projects.map((project) => this.read(project)))).flat();
    const ids = new Set(spans.map((span) => `${span.project}/${span.trace_id}/${span.span_id}`));
    return {
      unknown_cost_spans: spans.filter((span) => span.cost_usd === null).length,
      missing_parent_links: spans.filter(
        (span) => span.parent_span_id && !ids.has(`${span.project}/${span.trace_id}/${span.parent_span_id}`),
      ).length,
      write_errors: this.writeErrors,
    };
  }

  /** A project's spans, oldest first. */
  async read(project: string, filter: SpanFilter = {}): Promise<SpanRecord[]> {
    await this.flush();
    const spans: SpanRecord[] = [];
    if (this.storage?.pool) {
      await this.storage.init();
      const rows = await this.storage.pool.query(
        `SELECT data FROM factory_trace_events WHERE kind='span' AND data->>'project'=$1
           AND ($2::text IS NULL OR data->>'trace_id'=$2) AND ($3::text IS NULL OR data->>'task_id'=$3)
           AND ($4::text IS NULL OR data->>'feature_id'=$4) AND ($5::text IS NULL OR data->>'ended_at'>=$5)
         ORDER BY data->>'ended_at', sequence`,
        [
          project,
          filter.trace_id ?? null,
          filter.task_id ?? null,
          filter.feature_id ?? null,
          filter.since ?? null,
        ],
      );
      for (const row of rows.rows) {
        const { kind: _k, run_id: _r, at: _a, sequence: _s, ...data } = row.data as Record<string, unknown>;
        const span = SpanRecord.safeParse(data);
        if (span.success) spans.push(span.data);
      }
      return spans;
    }
    const dir = join(this.root, project, 'trace');
    const files = (await readdir(dir).catch(() => [] as string[]))
      .filter((f) => /^spans-\d{4}-\d{2}\.jsonl$/.test(f))
      .filter((f) => !filter.since || f.slice(6, 13) >= filter.since.slice(0, 7))
      .sort();
    for (const file of files)
      for (const line of (await readFile(join(dir, file), 'utf8')).split('\n')) {
        if (!line) continue;
        const span = SpanRecord.safeParse(JSON.parse(line));
        if (!span.success) continue;
        const s = span.data;
        if (filter.trace_id && s.trace_id !== filter.trace_id) continue;
        if (filter.task_id && s.task_id !== filter.task_id) continue;
        if (filter.feature_id && s.feature_id !== filter.feature_id) continue;
        if (filter.since && s.ended_at < filter.since) continue;
        spans.push(s);
      }
    return spans.sort((a, b) => a.ended_at.localeCompare(b.ended_at));
  }

  /** Where a delegate child of this grant token hangs; set while the parent call runs. */
  grantParent(token: string): TraceScope | undefined {
    return this.grantParents.get(token);
  }
  /** Hangs a grant's children under a span written later (a detached review turn). */
  bindGrant(token: string, scope: TraceScope): void {
    this.grantParents.set(token, scope);
  }
  unbindGrant(token: string): void {
    this.grantParents.delete(token);
  }

  /**
   * A runner that writes a span for each call, and tool and loop-judge spans under it. `scope`
   * is read at each call, so a caller may fill it in as it learns more (the task class).
   * A call with `traceParent` (a delegate child) hangs under that span instead. A scope function
   * that returns undefined leaves the call untraced.
   */
  runner(
    base: ModelRunner,
    scope: TraceScope | (() => TraceScope | undefined),
    type: SpanType = 'model',
  ): ModelRunner {
    return {
      run: async (request: ModelRun) => {
        const parent = request.traceParent ?? (typeof scope === 'function' ? scope() : scope);
        if (!parent) return base.run(request);
        const spanId = newSpanId();
        const own: TraceScope = { ...parent, parent_span_id: spanId };
        const tools = new ToolSpans();
        const extra: SpanBody[] = [];
        let judgeCost = 0;
        const onEvent = (event: AgentEvent) => {
          tools.event(event);
          if (event.type === 'judge') {
            judgeCost += event.costUsd ?? 0;
            extra.push({
              type: 'loop-judge',
              name: 'loop guard',
              started_at: event.startedAt,
              ended_at: new Date(Date.parse(event.startedAt) + event.durationMs).toISOString(),
              duration_ms: event.durationMs,
              outcome: 'completed',
              cost_usd: event.costUsd,
              cost_source: event.costUsd === null ? 'unknown' : 'reported',
              attributes: { stuck: event.stuck, confidence: event.confidence },
            });
          }
          request.onEvent?.(event);
        };
        if (request.mcp) this.grantParents.set(request.mcp.token, own);
        const started = Date.now();
        const isChild = !!request.traceParent || request.step?.startsWith('delegate:');
        const finish = (body: Partial<SpanBody>, result?: ModelResult) => {
          const ended = Date.now();
          this.append(parent, {
            span_id: spanId,
            type: isChild ? 'child' : type,
            name: request.step ?? type,
            step: request.step,
            model: request.model,
            provider: providerOf(request.model),
            gateway: 'direct',
            started_at: new Date(started).toISOString(),
            ended_at: new Date(ended).toISOString(),
            duration_ms: ended - started,
            outcome: 'completed',
            ...(result?.usage ? { tokens: spanTokens(result.usage) } : {}),
            ...body,
            ...(body.cost_usd !== undefined
              ? { cost_source: body.cost_usd === null ? 'unknown' : 'reported' }
              : {}),
          } as SpanBody);
          this.append(own, ...tools.finish(), ...extra);
        };
        try {
          const { traceParent: _, ...forward } = request;
          const result = await base.run({ ...forward, onEvent });
          // The provider adds the loop judge's cost to the call; the judge span carries it instead.
          finish({ cost_usd: result.costUsd === null ? null : result.costUsd - judgeCost }, result);
          return result;
        } catch (error) {
          const cost = errorCost(error);
          finish({
            outcome: aborted(error) ? 'aborted' : 'failed',
            error: errorText(error),
            cost_usd: cost === null ? null : cost - judgeCost,
          });
          throw error;
        } finally {
          if (request.mcp) this.grantParents.delete(request.mcp.token);
        }
      },
    };
  }
}
