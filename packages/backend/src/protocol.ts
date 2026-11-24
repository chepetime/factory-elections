import type { ActivitySnapshot } from './activity.ts';
import type { CleanupRecord, ExecutionPhase } from '@factory/core';
import { fromJSON } from '@grpc/proto-loader';
import type { ServiceDefinition } from '@grpc/grpc-js';
import descriptor from './descriptor.json' with { type: 'json' };

export const definition = fromJSON(descriptor as unknown as Parameters<typeof fromJSON>[0], {
  keepCase: true,
  defaults: true,
})['factory.v1.Factory'] as ServiceDefinition;
export interface Target {
  project: string;
  id?: string;
}
export interface ReviewTarget {
  project: string;
  number: number;
}
export interface Command extends Target {
  id: string;
  action: string;
  note?: string;
  head?: string;
  accept_blocking?: boolean;
  draft?: boolean;
  max_attempts?: number;
}
export interface BackgroundRun {
  running: boolean;
  phase?: ExecutionPhase;
  label?: string;
  logTail?: string;
  runId?: string;
  state?: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
  error?: string;
  /** While the run executes: its current command and when it last printed anything. */
  activity?: ActivitySnapshot;
  /** Whether the run's processes are known to be gone (ADR 0005). */
  cleanup?: CleanupRecord;
}
export interface Methods {
  GetDiagnostics: [{}, { json: string }];
  GetTeam: [Target, { json: string }];
  ListTeamRecords: [Target, { json: string }];
  SaveTeamRecord: [{ project: string; json: string }, { json: string }];
  GetGitUser: [Target, { text: string }];
  UpdateMembers: [{ project: string; json: string }, { json: string }];
  SaveAssignment: [{ project: string; email: string; team?: string; tags: string[] }, { text: string }];
  ListProjects: [{}, { json: string }];
  AddProject: [{ name: string; repo: string }, { json: string }];
  ListPullRequests: [{ project: string; drafts?: boolean; approved?: boolean }, { json: string }];
  StartReviews: [{ project: string; numbers: number[]; mode: 'review' | 'rereview' }, { json: string }];
  GetReview: [ReviewTarget, { json: string }];
  SendReviewMessage: [ReviewTarget & { text: string }, { text: string }];
  StopReview: [ReviewTarget, { text: string }];
  RemoveReview: [ReviewTarget, { text: string }];
  GetProjectSettings: [Target, { json: string }];
  SaveProjectSettings: [{ project: string; json: string }, { json: string }];
  DetectProjectSettings: [Target, { json: string }];
  /** Facts, pruned tools and review cost; `id` is unused. */
  GetMemory: [Target, { json: string }];
  /** Drops the fact whose id is `id`. */
  ForgetFact: [Target, { text: string }];
  /** Brings back every pruned review tool; `id` is unused. */
  RestoreTools: [Target, { text: string }];
  /** The project's features, newest first; `id` is unused. */
  ListFeatures: [Target, { json: string }];
  /** One feature with its spec, critique and QA plan; `id` is the feature id. */
  GetFeature: [Target, { json: string }];
  /** `json`: `{ idea, title? }`. */
  CreateFeature: [{ project: string; json: string }, { json: string }];
  /** `json`: `{ id, action, … }`, see FeatureAction in packages/backend/src/features.ts. */
  FeatureAction: [{ project: string; json: string }, { json: string }];
  /** `json`: `{ task_id? , trace_id?, feature_id? }`; returns `{ spans, roots }` (trees with rolled-up cost). */
  GetTrace: [{ project: string; json: string }, { json: string }];
  /** `json`: `{ from?, to? }` ISO times (default: the last 7 days); empty `project`: every project. */
  GetMetrics: [{ project: string; json: string }, { json: string }];
  /** Everything that waits on the human, across projects: `{ items, dismissed }`. */
  ListPrReviewRecords: [Target, { json: string }];
  AddPrReviewRecord: [{ project: string; json: string }, { json: string }];
  ListOutcomes: [Target, { json: string }];
  AddOutcome: [{ project: string; json: string }, { json: string }];
  ListExperiments: [Target, { json: string }];
  AddExperiment: [{ project: string; json: string }, { json: string }];
  GetInbox: [{}, { json: string }];
  /** `json`: `{ id }`; `project` is unused. */
  DismissInboxItem: [{ project: string; json: string }, { text: string }];
  /** Tends task `id`'s PR now (and resumes a stopped one); empty `id`: one pass over every tended PR. */
  TendPullRequests: [Target, { json: string }];
  ListTickets: [Target, { json: string }];
  ListTasks: [Target, { json: string }];
  GetTask: [Target, { json: string }];
  GetTaskControls: [Target, { json: string }];
  GetGate: [Target, { json: string }];
  GetDiff: [Target, { text: string }];
  SubmitTask: [{ project: string; prompt: string; jiraKey?: string }, { text: string }];
  ExecuteTask: [Command, { text: string }];
  StartRun: [Command, { json: string }];
  GetBackground: [Target, { json: string }];
  ClearLog: [Target, { text: string }];
  StopRun: [Target, { text: string }];
  ConfirmCleanup: [Target, { text: string }];
  StartProfileCheck: [Target, { json: string }];
  GetProfileCheck: [Target, { json: string }];
}
