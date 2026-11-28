// The command a run executes and the record of one run, as stored in `runs/<id>/run.json`.
import { join } from 'node:path';
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
  handoff_agent: z.string().optional(),
  state: z.enum(['queued', 'running', 'completed', 'failed', 'interrupted']),
  created_at: z.string(),
  finished_at: z.string().optional(),
  error: z.string().optional(),
  dismissed: z.boolean().optional(),
  /** How the run ended, apart from `state` (ADR 0005). Absent in older records: see runOutcome. */
  outcome: ExecutionOutcome.optional(),
  /** Whether the run's processes are known to be gone. Absent: not recorded. */
  cleanup: CleanupRecord.optional(),
  /**
   * Set when the task's previous run was interrupted and nothing was left to confirm: this run
   * clears the worktree's stale git locks before its first git command.
   */
  after_interrupted: z.boolean().optional(),
  /** The provider sessions the run's model calls used, as references. */
  provider_sessions: z.array(ProviderSessionRef).optional(),
  /** What the run's model calls were given: one entry per distinct configuration (Phase 4). */
  manifests: z.array(CallManifest).optional(),
  /**
   * The generation of the backend that owns this record (docs/adr/0005). Every run.json write
   * compares it first, so an old backend cannot overwrite what a newer one settled. Absent = 0.
   */
  owner_generation: z.number().int().min(0).optional(),
});
export type RunRecord = z.infer<typeof RunRecord>;
export type RunCommand = z.infer<typeof CommandSchema>;

/** The generation a stored record belongs to; records from before the fence have none: 0. */
export function ownerOf(record: { owner_generation?: number | undefined }): number {
  return record.owner_generation ?? 0;
}

export type RunWrite = { written: true } | { written: false; current: unknown };

/**
 * The one way to write `run.json`. Writes `next` only if the stored record's generation is still
 * `expected`; otherwise writes nothing and returns what is stored. A missing document is not
 * written either (a deleted task's run is never brought back).
 */
export async function writeRun(
  storage: {
    writeDocumentIf(path: string, data: unknown, expected: number): Promise<RunWrite>;
  },
  dir: string,
  next: RunRecord,
  expected: number,
): Promise<RunWrite> {
  return storage.writeDocumentIf(join(dir, 'run.json'), next, expected);
}
