import type { CleanupRecord, ExecutionPhase } from '@factory/core';
import { fromJSON } from '@grpc/proto-loader';
import type { ServiceDefinition } from '@grpc/grpc-js';
import descriptor from './descriptor.json' with { type: 'json' };
import type { RPCS, RpcName } from './rpcs.ts';

export const definition = fromJSON(descriptor as unknown as Parameters<typeof fromJSON>[0], {
  keepCase: true,
  defaults: true,
})['factory.v1.Factory'] as ServiceDefinition;
/** What a run is doing right now: the current command, when it started, and the last output. */
export interface ActivitySnapshot {
  run_started_at: string;
  command?: string;
  command_started_at?: string;
  last_output_at?: string;
}
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
  /** follow-up: the agent that does it. */
  agent?: string;
  /** follow-up: `custom` or `conflicts`. */
  kind?: string;
  /** follow-up: `you` or `factory`. */
  by?: string;
  /** follow-up: the PR head when the conflict watcher added it. */
  pr_head?: string;
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
/** The TypeScript shape of each factory.proto message, as callers send and receive it. */
export interface Messages {
  Empty: {};
  Target: Target;
  Snapshot: { json: string };
  Text: { text: string };
  Submission: { project: string; prompt: string; jiraKey?: string };
  ProjectRegistration: { name: string; repo: string };
  PullRequestQuery: { project: string; drafts?: boolean; approved?: boolean };
  ReviewTarget: ReviewTarget;
  ReviewStart: { project: string; numbers: number[]; mode: 'review' | 'rereview' };
  ReviewMessage: ReviewTarget & { text: string };
  SettingsUpdate: { project: string; json: string };
  ProviderTest: { provider: string };
  Command: Command;
  Assignment: { project: string; email: string; team?: string; tags: string[] };
}
/** Request and response of every RPC, from the RPCS list (see rpcs.ts for what each carries). */
export type Methods = {
  [K in RpcName]: [Messages[(typeof RPCS)[K][0]], Messages[(typeof RPCS)[K][1]]];
};
