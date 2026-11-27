// One retry of a model call that ended with no result (ADR 0107). The driver decides, not the
// adapter: only the driver knows the saved session, the budget left and the attempts so far, and a
// retry here leaves a record on the attempt and in the task's events.
import type { ModelResult, ModelRun, ModelRunner } from '@factory/core';
import { errorCost, errorKind } from './support.ts';

/** What the resumed turn is told: the model has its own history, so the prompt stays short. */
export const NO_RESULT_RESUME_PROMPT = 'Your last turn was cut off. Check the worktree state, then continue.';

export interface ResultRetry {
  /** The call that finished, whether it was the first or the retry. */
  result: ModelResult;
  /** Set when the first call ended with no result and the second one ran. */
  retried?: 'no-result';
  /** The first failure's message, kept when a retry ran. */
  firstError?: string;
}

/** A second `no-result` failure; it carries both messages and the cost of both calls. */
export class NoResultAfterRetry extends Error {
  readonly kind = 'no-result' as const;
  readonly costUsd: number | null;
  constructor(first: Error, second: Error, costUsd: number | null) {
    super(`${second.message} (retried once after: ${first.message})`);
    this.costUsd = costUsd;
  }
}

function toolCallsOf(error: unknown): number | undefined {
  const calls = (error as { activity?: { toolCalls?: unknown } } | null)?.activity?.toolCalls;
  return typeof calls === 'number' ? calls : undefined;
}

function sum(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

export interface ResultRetryOptions {
  /** The provider session saved so far; read after the first call fails. */
  sessionId(): string | undefined;
  /** Called once, before the second call, so the caller can persist the retry. */
  onRetry?(firstError: Error, mode: 'resume' | 'restart'): Promise<void> | void;
}

/**
 * Runs `request`; when the call ends with no result (kind `no-result`) it runs once more.
 * - With a saved session the retry resumes it with a short prompt, under the budget that is left.
 * - Without one the retry starts the request again, but only when the call made no tool call: a
 *   tool may have had a side effect, and nothing is known to resume.
 * Aborted, timeout, stalled, budget, rate-limited, usage-limit and other errors are not retried.
 */
export async function runWithResultRetry(
  runner: ModelRunner,
  request: ModelRun,
  options: ResultRetryOptions,
): Promise<ResultRetry> {
  let first: Error;
  try {
    return { result: await runner.run(request) };
  } catch (error) {
    if (errorKind(error) !== 'no-result' || request.signal?.aborted) throw error;
    first = error instanceof Error ? error : new Error(String(error));
    const session = options.sessionId();
    const toolCalls = toolCallsOf(error);
    if (!session && toolCalls !== 0) throw error;
    const firstCost = errorCost(error);
    const left = request.maxBudgetUsd === undefined ? undefined : request.maxBudgetUsd - (firstCost ?? 0);
    if (left !== undefined && left <= 0) throw error;
    const again: ModelRun = {
      ...request,
      ...(left === undefined ? {} : { maxBudgetUsd: Math.max(0.01, left) }),
      ...(session ? { resume: session, prompt: NO_RESULT_RESUME_PROMPT } : {}),
    };
    await options.onRetry?.(first, session ? 'resume' : 'restart');
    try {
      return { result: await runner.run(again), retried: 'no-result', firstError: first.message };
    } catch (second) {
      const two = second instanceof Error ? second : new Error(String(second));
      if (errorKind(second) !== 'no-result') {
        // A different failure ends the task as it would have: the first one stays in the message.
        throw Object.assign(two, {
          message: `${two.message} (after a retry of: ${first.message})`,
          costUsd: sum(firstCost, errorCost(second)),
        });
      }
      throw new NoResultAfterRetry(first, two, sum(firstCost, errorCost(second)));
    }
  }
}
