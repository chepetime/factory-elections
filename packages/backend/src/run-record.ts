// The command a run executes and the record of one run, as stored in `runs/<id>/run.json`.
import { z } from 'zod';
import {
  CallManifest,
  CleanupRecord,
  ExecutionOutcome,
  ProjectName,
  ProviderSessionRef,
  TaskCommand,
  TaskId,
} from '@factory/core';

export const TargetSchema = z.object({ project: ProjectName, id: TaskId });
export const CommandSchema = TargetSchema.extend({
  action: TaskCommand,
  note: z.string().max(20_000).optional().default(''),
  head: z.string().max(64).optional().default(''),
  accept_blocking: z.boolean().optional().default(false),
  draft: z.boolean().optional().default(false),
  max_attempts: z.number().int().min(0).max(10).optional().default(0),
  // follow-up only (protobuf sends empty strings for the other commands).
  agent: z.string().max(100).optional().default(''),
  kind: z.enum(['custom', 'conflicts', 'review', '']).optional().default(''),
  by: z.string().max(40).optional().default(''),
  pr_head: z.string().max(64).optional().default(''),
});
export const RunRecord = z.object({
  id: TaskId,
  project: ProjectName,
  task_id: TaskId,
  action: TaskCommand,
  command: CommandSchema,
  label: z.string(),
  state: z.enum(['queued', 'running', 'completed', 'failed', 'interrupted']),
  created_at: z.string(),
  finished_at: z.string().optional(),
  error: z.string().optional(),
  dismissed: z.boolean().optional(),
  /** How the run ended, apart from `state` (ADR 0005). Absent in older records: see runOutcome. */
  outcome: ExecutionOutcome.optional(),
  /** Whether the run's processes are known to be gone. Absent: not recorded. */
  cleanup: CleanupRecord.optional(),
  /** The provider sessions the run's model calls used, as references. */
  provider_sessions: z.array(ProviderSessionRef).optional(),
  /** What the run's model calls were given: one entry per distinct configuration (Phase 4). */
  manifests: z.array(CallManifest).optional(),
});
export type RunRecord = z.infer<typeof RunRecord>;
export type RunCommand = z.infer<typeof CommandSchema>;
