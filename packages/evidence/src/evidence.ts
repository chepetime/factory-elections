// Effect spans and append-only JSONL evidence. No prompts, credentials or model output are traced.
import { closeSync, openSync, writeSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DataStorage, ArtifactWriter } from '@factory/adapters-data';
import { randomUUID } from 'node:crypto';
import { Effect, type Tracer } from 'effect';
import type { ModelRunner } from '@factory/core';

export interface EvidenceOptions {
  /**
   * Makes the trace best-effort: a failed write goes here instead of failing the traced work, and
   * later events go to a new stream. Use it for diagnostics such as RPC spans, never for run
   * evidence, which must stop model work when it cannot be persisted.
   */
  onWriteError?: (error: unknown) => void;
}

export class Evidence {
  private readonly fd?: number;
  private events?: ArtifactWriter;
  private output?: ArtifactWriter;
  private sequence = 0;
  private generation = 0;
  private readonly storage?: DataStorage;
  private readonly onWriteError?: (error: unknown) => void;
  readonly path: string;
  readonly runId: string;
  constructor(path: string, runId: string, storage?: DataStorage, options: EvidenceOptions = {}) {
    this.path = path;
    this.runId = runId;
    this.onWriteError = options.onWriteError;
    if (storage?.config) {
      this.storage = storage;
      this.events = storage.writer(path);
      this.output = storage.writer(join(dirname(path), 'run.log'));
    } else this.fd = openSync(path, 'ax', 0o600);
  }
  record(kind: string, fields: Record<string, unknown> = {}): void {
    const event = {
      at: new Date().toISOString(),
      sequence: ++this.sequence,
      run_id: this.runId,
      kind,
      ...fields,
    };
    const text = `${JSON.stringify(event)}\n`;
    this.guard(() => {
      if (this.events) this.events.append(text, event);
      else writeSync(this.fd!, text);
    });
  }
  log(message: string, fields: Record<string, unknown> = {}): void {
    this.record('log', { ...fields, message });
    this.guard(() => {
      if (this.output) this.output.append(`${message}\n`);
      else appendFileSync(join(dirname(this.path), 'run.log'), `${message}\n`, { mode: 0o600 });
    });
  }
  async flush(): Promise<void> {
    try {
      await this.events?.flush();
      await this.output?.flush();
    } catch (error) {
      if (!this.onWriteError) throw error;
      this.recover(error);
    }
  }
  async close(): Promise<void> {
    try {
      await this.flush();
    } finally {
      if (this.fd !== undefined) closeSync(this.fd);
    }
  }
  private guard(write: () => void): void {
    try {
      write();
    } catch (error) {
      if (!this.onWriteError) throw error;
      this.recover(error);
    }
  }
  /** A remote writer latches its first failure, so a best-effort trace moves to new streams. */
  private recover(error: unknown): void {
    this.onWriteError!(error);
    if (!this.storage) return;
    const suffix = `.${++this.generation}`;
    this.events = this.storage.writer(this.path.replace(/(\.jsonl)?$/, `${suffix}$1`));
    this.output = this.storage.writer(join(dirname(this.path), `run${suffix}.log`));
  }
  span<A>(
    name: string,
    attributes: Record<string, unknown>,
    action: (span: Tracer.Span) => Promise<A>,
    parent?: Tracer.Span,
  ): Promise<A> {
    const record = this.record.bind(this);
    const flush = this.flush.bind(this);
    let program = Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      const context = {
        trace_id: span.traceId,
        span_id: span.spanId,
        parent_span_id: parent?.spanId,
        name,
        attributes,
      };
      const start = performance.now();
      yield* Effect.tryPromise({
        try: async () => {
          record('span.start', context);
          await flush();
        },
        catch: (error) => error,
      });
      return yield* Effect.tryPromise({ try: () => action(span), catch: (error) => error }).pipe(
        Effect.tap(() =>
          Effect.tryPromise({
            try: async () => {
              record('span.end', {
                ...context,
                outcome: 'completed',
                duration_ms: performance.now() - start,
              });
              await flush();
            },
            catch: (error) => error,
          }),
        ),
        Effect.tapError((error) =>
          Effect.tryPromise({
            try: async () => {
              record('span.end', {
                ...context,
                outcome: 'failed',
                duration_ms: performance.now() - start,
                error: String(error),
              });
              await flush();
            },
            catch: (error) => error,
          }),
        ),
      );
    }).pipe(Effect.withSpan(name, { attributes }));
    if (parent) program = program.pipe(Effect.withParentSpan(parent));
    // Unwrap the typed failure at the Promise boundary instead of leaking Effect's FiberFailure wrapper.
    return Effect.runPromise(Effect.either(program)).then((result) => {
      if (result._tag === 'Left') throw result.left;
      return result.right;
    });
  }
  runner(base: ModelRunner, parent: Tracer.Span): ModelRunner {
    return {
      run: (request) =>
        this.span(
          'model.run',
          {
            step:
              request.step ??
              (request.tools === 'none' ? 'classifier' : request.tools === 'edit' ? 'coder' : 'reviewer'),
            model: request.model,
            effort: request.effort,
          },
          async (span) => {
            const attemptId = randomUUID();
            try {
              const result = await base.run(request);
              span.attribute('cost_usd', result.costUsd);
              this.record('model.cost', {
                trace_id: span.traceId,
                span_id: span.spanId,
                attempt_id: attemptId,
                model: request.model,
                step: request.step,
                cost_usd: result.costUsd,
                outcome: 'completed',
              });
              await this.flush();
              return result;
            } catch (error) {
              this.record('model.cost', {
                trace_id: span.traceId,
                span_id: span.spanId,
                attempt_id: attemptId,
                model: request.model,
                step: request.step,
                cost_usd:
                  typeof error === 'object' && error !== null && 'costUsd' in error ? error.costUsd : null,
                outcome: 'failed',
              });
              await this.flush();
              throw error;
            }
          },
          parent,
        ),
    };
  }
}
