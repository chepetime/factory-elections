// One trace model for all agent work. Every unit of work writes one span record when it ends:
// a task run, a model call, a tool call, a child task, a review turn, a feature step, a memory
// review, a loop-guard judgement and a human gate. Spans form a tree with `parent_span_id`, and
// one `trace_id` joins a run with everything it caused.
//
// Cost rules: a span's `cost_usd` is its own cost only, so a roll-up adds every span of a trace.
// `null` means the provider did not report a cost: a gap, never $0. A tool span has no cost of
// its own; its model call carries it.
//
// Day-one fields, cheap now and painful to add later: the task class, the replay inputs, gate
// spans for human time, the ticket and PR links, and the task id that later outcome records join on.
import { z } from 'zod';
import { parseModelRef, type AgentEvent, type Usage } from './agents.ts';

export const SpanType = z.enum([
  /** One agent execution on a task: classify, code, verify, review, PR. The root of a task trace. */
  'run',
  'model',
  'tool',
  /** A `delegate` child task, on any provider. */
  'child',
  /** One turn of a PR review chat. */
  'review',
  /** One agent step of a feature: grill, spec, critique, tickets, QA. */
  'feature-step',
  /** One turn of a chat with a workspace agent. */
  'chat',
  'memory-review',
  'loop-judge',
  /** Time a task waited for the human at the approval gate. */
  'gate',
  /** A task's PR opened: links the task's traces to the PR. */
  'pr',
]);
export type SpanType = z.infer<typeof SpanType>;

export const SpanTokens = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cache_read: z.number().int().nonnegative().optional(),
  cache_write: z.number().int().nonnegative().optional(),
});
export type SpanTokens = z.infer<typeof SpanTokens>;

/** What a stored run needs to be run again on another model. */
export const ReplayInputs = z.object({
  repo: z.string(),
  base_branch: z.string().optional(),
  /** The commit the work started from. */
  base_sha: z.string().optional(),
  /** The task prompt (with the ticket and spec, for feature tickets). */
  prompt: z.string(),
  /** The commands that judged the result. */
  verification: z.array(z.string()).default([]),
});
export type ReplayInputs = z.infer<typeof ReplayInputs>;

const Attribute = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const SpanRecord = z.object({
  trace_id: z.string().min(1),
  span_id: z.string().min(1),
  parent_span_id: z.string().optional(),
  type: SpanType,
  name: z.string().min(1),
  project: z.string().min(1),
  started_at: z.string(),
  ended_at: z.string(),
  /** Absent when the source gives no timing (tool calls of a detached review turn). */
  duration_ms: z.number().nonnegative().optional(),
  outcome: z.enum(['completed', 'failed', 'aborted']),
  error: z.string().max(2000).optional(),
  /** Null: the provider reported no cost. Absent: the span has no cost of its own (tools, gates). */
  cost_usd: z.number().nullable().optional(),
  /** How the span cost was obtained; absent for spans without their own cost. */
  cost_source: z.enum(['reported', 'computed', 'unknown']).optional(),
  tokens: SpanTokens.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  /** Where the model was reached: `direct` today; OpenRouter or a custom gateway later. */
  gateway: z.string().optional(),
  /** The workflow step: classifier, coder, reviewer, pr-writer, feature:spec, delegate:codex… */
  step: z.string().optional(),
  task_id: z.string().optional(),
  feature_id: z.string().optional(),
  /** The feature board ticket and the task-manager issue it mirrors. */
  ticket: z.object({ id: z.string().optional(), key: z.string().optional() }).optional(),
  pr: z.object({ url: z.string(), number: z.number().int().optional() }).optional(),
  /** What kind of work this is, so runs of one kind can be compared and routed: `code/S`. */
  task_class: z.string().optional(),
  replay: ReplayInputs.optional(),
  attributes: z.record(z.string(), Attribute).optional(),
});
export type SpanRecord = z.infer<typeof SpanRecord>;

/** The fields every span of one trace shares. */
export type TraceFields = Pick<
  SpanRecord,
  'trace_id' | 'project' | 'task_id' | 'feature_id' | 'ticket' | 'pr' | 'task_class'
>;

const hex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
/** Where a traced call hangs in the tree, and what its spans share. */
export interface TraceScope extends TraceFields {
  /** The span new spans hang under. */
  parent_span_id?: string;
}

export const newTraceId = (): string => hex(16);
export const newSpanId = (): string => hex(8);

export function spanTokens(usage: Usage | undefined): SpanTokens | undefined {
  if (!usage) return undefined;
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    ...(usage.cachedInputTokens !== undefined ? { cache_read: usage.cachedInputTokens } : {}),
    ...(usage.cacheWriteInputTokens !== undefined ? { cache_write: usage.cacheWriteInputTokens } : {}),
  };
}

/** The provider of a model ref, without throwing on a ref the router does not know. */
export function providerOf(model: string | undefined): string | undefined {
  if (!model) return undefined;
  try {
    return parseModelRef(model).provider;
  } catch {
    return undefined;
  }
}

/** `code/S` from a classifier verdict; undefined before classification. */
export function taskClass(verdict: { kind?: string; loe?: string } | undefined): string | undefined {
  return verdict?.kind ? `${verdict.kind}/${verdict.loe ?? 'unknown'}` : undefined;
}

/** A short, safe description of a tool call's input: the command or path, never file contents. */
export function toolSummary(input: Record<string, unknown>): string | undefined {
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'task']) {
    const value = input[key];
    if (typeof value === 'string' && value) return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  return undefined;
}

export interface OpenTool {
  name: string;
  callId?: string;
  summary?: string;
  started: number;
  sub: boolean;
}

/**
 * Turns a provider's event stream into tool spans. A result closes the open call with its call id.
 * Events without ids (older adapters, recorded logs) close the oldest open call of the same agent
 * (main or subagent). Calls without a result end as failed when the stream ends.
 */
export class ToolSpans {
  private readonly open: OpenTool[] = [];
  private readonly done: Omit<SpanRecord, keyof TraceFields | 'parent_span_id'>[] = [];
  private readonly clock: () => number;
  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }
  event(event: AgentEvent): void {
    if (event.type === 'tool') {
      const summary = toolSummary(event.input);
      this.open.push({
        name: event.name,
        ...(event.callId ? { callId: event.callId } : {}),
        ...(summary ? { summary } : {}),
        started: this.clock(),
        sub: !!event.sub,
      });
    } else if (event.type === 'tool-result') {
      const at = event.callId
        ? this.open.findIndex((t) => t.callId === event.callId)
        : this.open.findIndex((t) => t.sub === !!event.sub);
      if (at < 0) return;
      const [call] = this.open.splice(at, 1);
      this.close(call!, event.ok ? 'completed' : 'failed', event.ok ? undefined : event.text);
    }
  }
  private close(call: OpenTool, outcome: 'completed' | 'failed', error?: string, timed = true): void {
    const end = this.clock();
    this.done.push({
      span_id: newSpanId(),
      type: 'tool',
      name: call.name,
      started_at: new Date(call.started).toISOString(),
      ended_at: new Date(end).toISOString(),
      ...(timed ? { duration_ms: Math.max(0, end - call.started) } : {}),
      outcome,
      ...(error ? { error: error.slice(0, 2000) } : {}),
      attributes: { ...(call.summary ? { input: call.summary } : {}), subagent: call.sub },
    });
  }
  /** The finished tool spans; open calls close as failed. `timed: false` drops durations. */
  finish(timed = true): Omit<SpanRecord, keyof TraceFields | 'parent_span_id'>[] {
    for (const call of this.open.splice(0)) this.close(call, 'failed', 'no result', timed);
    if (!timed) for (const span of this.done) delete span.duration_ms;
    return this.done.splice(0);
  }
}
