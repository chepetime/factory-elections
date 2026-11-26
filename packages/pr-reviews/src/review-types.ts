// The shapes the review service returns to the backend and the web app.
import {
  ReviewPayload,
  type ContextStatus,
  type PullRequestSummary,
  type ReviewChatEntry,
  type ReviewState,
} from '@factory/core';

export interface ReviewStatus {
  /** State of the latest agent turn. */
  state?: ReviewState;
  started_at?: string;
  finished_at?: string;
  exit_code?: number;
  /** User messages in the chat, including the kickoff. */
  turns: number;
  /** The agent saved a report payload. */
  report: boolean;
  /** Verdict and risk from the payload, for the list. */
  decision?: string;
  risk?: string;
  /** A review worktree is registered for this PR's branch. */
  worktree: boolean;
  /** Why the last start failed after it was accepted (fetching the PR or preparing its worktree). */
  error?: string;
  stop_reason?: 'stalled';
}
export interface ReviewRow extends PullRequestSummary {
  review: ReviewStatus;
}
/** One finding of a saved review report, with the PR it belongs to. */
export interface ReviewFindingRow {
  project: string;
  number: number;
  /** Position in the report, to keep its order. */
  index: number;
  title: string;
  url: string;
  /** When the review's latest turn started. */
  at: string;
  decision?: string;
  severity?: string;
  axis?: string;
  finding: string;
  file?: string;
  line_range?: string;
  fix?: string;
}
export interface ReviewDetail extends ReviewStatus {
  number: number;
  branch?: string;
  url?: string;
  title?: string;
  /** Whether a follow-up message can continue this chat now. */
  can_reply: boolean;
  conversation: ReviewChatEntry[];
  payload?: ReviewPayload;
  payload_error?: string;
  /** Dollars the agent reported over all turns; absent when no turn reported a cost. */
  cost_usd?: number;
  /** The latest turn's context size against the project's limit (warn at 80%). */
  context?: ContextStatus;
}
