import type { ExecutionPhase } from '@factory/core';
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
}
export interface Methods {
  GetDiagnostics: [{}, { json: string }];
  GetTeam: [Target, { json: string }];
  GetGitUser: [Target, { text: string }];
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
  ListTasks: [Target, { json: string }];
  GetTask: [Target, { json: string }];
  GetTaskControls: [Target, { json: string }];
  GetGate: [Target, { json: string }];
  GetDiff: [Target, { text: string }];
  SubmitTask: [{ project: string; prompt: string }, { text: string }];
  ExecuteTask: [Command, { text: string }];
  StartRun: [Command, { json: string }];
  GetBackground: [Target, { json: string }];
  ClearLog: [Target, { text: string }];
}
