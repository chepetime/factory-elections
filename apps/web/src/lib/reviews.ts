// Server-only typed bridge for PR reviews. Worktrees, review agents and reports belong to the backend.
import 'server-only';
import { z } from 'zod';
import { ReviewLoopState } from '@factory/core';
import { backendCall } from '@factory/backend-client';
import { PullRequestSummary, ReviewPayload, ReviewState } from '@factory/core';
export type { ReviewPayload };
import { backendError, type Result } from '@/lib/factory';

const ReviewStatus = z.object({
  state: ReviewState.optional(),
  started_at: z.string().optional(),
  finished_at: z.string().optional(),
  exit_code: z.number().optional(),
  turns: z.number().int(),
  report: z.boolean(),
  decision: z.string().optional(),
  risk: z.string().optional(),
  worktree: z.boolean(),
  error: z.string().optional(),
  stop_reason: z.enum(['stalled']).optional(),
});
export const ReviewRow = PullRequestSummary.extend({ review: ReviewStatus });
export type ReviewRow = z.infer<typeof ReviewRow>;
const ReviewList = z.object({ me: z.string(), pulls: z.array(ReviewRow) });
export type ReviewList = z.infer<typeof ReviewList>;
const Result_ = z.object({
  ok: z.boolean(),
  text: z.string(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
});
const ChatEntry = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('user'),
    id: z.string(),
    at: z.string(),
    text: z.string(),
    label: z.string().optional(),
  }),
  z.object({
    role: z.literal('agent'),
    id: z.string(),
    at: z.string(),
    blocks: z.array(z.object({ kind: z.enum(['text', 'tool']), text: z.string() })),
    result: Result_.optional(),
  }),
]);
export const ReviewDetail = ReviewStatus.extend({
  number: z.number().int(),
  branch: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  can_reply: z.boolean(),
  conversation: z.array(ChatEntry),
  payload: ReviewPayload.optional(),
  payload_error: z.string().optional(),
  cost_usd: z.number().optional(),
});
export type ReviewDetail = z.infer<typeof ReviewDetail>;
export type ReviewChatEntry = z.infer<typeof ChatEntry>;
const StartResults = z.array(z.object({ number: z.number(), ok: z.boolean(), error: z.string().optional() }));
export type StartResults = z.infer<typeof StartResults>;

export function isPrNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000;
}

async function attempt<T>(call: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof z.ZodError ? 'The backend returned an invalid record.' : backendError(error),
    };
  }
}

export function listPullRequests(
  project: string,
  drafts: boolean,
  approved: boolean,
): Promise<Result<ReviewList>> {
  return attempt(async () =>
    ReviewList.parse(
      JSON.parse((await backendCall('ListPullRequests', { project, drafts, approved }, 60_000)).json),
    ),
  );
}
export function reviewDetail(project: string, number: number): Promise<Result<ReviewDetail>> {
  return attempt(async () =>
    ReviewDetail.parse(JSON.parse((await backendCall('GetReview', { project, number })).json)),
  );
}
export function sendReviewMessageRun(project: string, number: number, text: string): Promise<Result<string>> {
  return attempt(async () => (await backendCall('SendReviewMessage', { project, number, text })).text);
}
/** Fetching and preparing worktrees for a large repository can take minutes. */
export function startReviewRuns(
  project: string,
  numbers: number[],
  mode: 'review' | 'rereview',
): Promise<Result<StartResults>> {
  return attempt(async () =>
    StartResults.parse(
      JSON.parse((await backendCall('StartReviews', { project, numbers, mode }, 600_000)).json),
    ),
  );
}
export function stopReviewRun(project: string, number: number): Promise<Result<string>> {
  return attempt(async () => (await backendCall('StopReview', { project, number })).text);
}
export function removeReviewRun(project: string, number: number): Promise<Result<string>> {
  return attempt(async () => (await backendCall('RemoveReview', { project, number }, 120_000)).text);
}

/** Makes a review ticket for the PR, or returns its existing ticket; resolves to the ticket key. */
export function createReviewTicketRun(project: string, number: number): Promise<Result<string>> {
  return attempt(async () => {
    const view = JSON.parse(
      (await backendCall('CreateReviewTicket', { project, json: JSON.stringify({ number }) }, 60_000)).json,
    ) as { key?: string; number?: number };
    return z.string().parse(view.key);
  });
}
/** Your decision on a review ticket's latest proposal: one of core reviewOptions' ids. */
export function decideReviewRun(project: string, key: string, option: string): Promise<Result<string>> {
  return attempt(async () => {
    await backendCall('DecideReview', { project, json: JSON.stringify({ key, option }) }, 60_000);
    return 'Sent.';
  });
}
/** The self-review loop of a task's agent PR, or null when it has none. */
export function getReviewLoop(project: string, id: string): Promise<Result<ReviewLoopState | null>> {
  return attempt(async () =>
    ReviewLoopState.nullable().parse(JSON.parse((await backendCall('GetReviewLoop', { project, id })).json)),
  );
}
