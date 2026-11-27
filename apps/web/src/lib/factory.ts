// Server-only gRPC bridge. Task state, execution and evidence belong to the local backend.
import 'server-only';
import { backendCall } from '@factory/backend-client';
import type { Command } from '@factory/backend-client/protocol';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  NAME_PATTERN,
  Project,
  TaskRecord,
  TaskControls,
  ExecutionPhase,
  executionPhase,
} from '@factory/core';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProjectName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

export function isTaskId(id: string): boolean {
  return UUID.test(id);
}

export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.FACTORY_ROOT ? resolve(env.FACTORY_ROOT) : join(homedir(), '.local', 'share', 'factory');
}

export function backendError(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  if (code === 14 || (error as NodeJS.ErrnoException)?.code === 'ENOENT')
    return 'Backend unavailable. Start it with `pnpm backend` or `pnpm web`.';
  const message =
    (error as { details?: string })?.details ??
    (error instanceof Error ? error.message : 'Backend request failed.');
  return message.replaceAll(dataRoot(), '<data root>');
}

async function readJson<T extends z.ZodType>(
  method: 'ListProjects' | 'ListTasks' | 'GetTask' | 'GetGate' | 'GetTaskControls',
  target: { project: string; id?: string },
  schema: T,
): Promise<Result<z.infer<T>>> {
  try {
    const response = await backendCall(method, target);
    const checked = schema.safeParse(JSON.parse(response.json));
    return checked.success
      ? { ok: true, value: checked.data }
      : { ok: false, error: 'The backend returned an invalid record.' };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}

/** A registered project with its display name and icon from project settings. */
export const ProjectSummary = Project.extend({
  display_name: z.string().optional(),
  icon: z.string().optional(),
  /** The accent a person picked; absent means the name's color (see projectAccent). */
  accent: z.string().optional(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;
export function listProjects(): Promise<Result<ProjectSummary[]>> {
  return readJson('ListProjects', { project: '' }, z.array(ProjectSummary));
}
/** AddProject replies with the project and the outcome of drafting its repo profile. */
const AddProjectReply = Project.extend({
  profile: z.discriminatedUnion('status', [
    z.object({ status: z.literal('drafted'), path: z.string() }),
    z.object({ status: z.literal('exists'), path: z.string() }),
    z.object({ status: z.literal('failed'), error: z.string() }),
  ]),
});
export async function addProjectRequest(name: string, repo: string): Promise<Result<Project>> {
  try {
    const checked = AddProjectReply.safeParse(
      JSON.parse((await backendCall('AddProject', { name, repo })).json),
    );
    return checked.success
      ? { ok: true, value: { name: checked.data.name, repo: checked.data.repo } }
      : { ok: false, error: 'The backend returned an invalid record.' };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}
export function listTasks(project: string): Promise<Result<TaskRecord[]>> {
  return readJson('ListTasks', { project }, z.array(TaskRecord));
}
export function showTask(project: string, id: string): Promise<Result<TaskRecord>> {
  return readJson('GetTask', { project, id }, TaskRecord);
}
export function readTaskControls(project: string, id: string): Promise<Result<TaskControls>> {
  return readJson('GetTaskControls', { project, id }, TaskControls);
}
export const Gate = z.object({
  task: TaskRecord,
  head_sha: z.string().min(1),
  diff_stat: z.string(),
  blockers: z.array(z.string()),
});
export type Gate = z.infer<typeof Gate>;
export function readGate(project: string, id: string): Promise<Result<Gate>> {
  return readJson('GetGate', { project, id }, Gate);
}
export async function readDiff(project: string, id: string): Promise<Result<string>> {
  try {
    return { ok: true, value: (await backendCall('GetDiff', { project, id })).text };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}

export async function submitTaskRequest(
  project: string,
  prompt: string,
  jiraKey?: string,
): Promise<Result<string>> {
  try {
    return {
      ok: true,
      value: (await backendCall('SubmitTask', { project, prompt, jiraKey })).text,
    };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}
export async function executeTask(request: Command, timeoutMs = 120_000): Promise<Result<string>> {
  try {
    return { ok: true, value: (await backendCall('ExecuteTask', request, timeoutMs)).text };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}
export async function startTask(request: Command): Promise<Result<string>> {
  try {
    const accepted = z
      .object({ id: z.uuid() })
      .parse(JSON.parse((await backendCall('StartRun', request)).json));
    return { ok: true, value: accepted.id };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}

const Background = z.object({
  running: z.boolean(),
  phase: ExecutionPhase.optional(),
  label: z.string().optional(),
  logTail: z.string().optional(),
  runId: z.string().optional(),
  state: z.enum(['queued', 'running', 'completed', 'failed', 'interrupted']).optional(),
  error: z.string().optional(),
  activity: z
    .object({
      run_started_at: z.string(),
      command: z.string().optional(),
      command_started_at: z.string().optional(),
      last_output_at: z.string().optional(),
    })
    .optional(),
  cleanup: z
    .object({
      status: z.enum(['clean', 'uncertain']),
      reasons: z.array(z.string()).optional(),
      confirmed_at: z.string().optional(),
    })
    .optional(),
});
export type BackgroundRun = z.infer<typeof Background>;
export async function backgroundRun(project: string, id: string): Promise<BackgroundRun> {
  try {
    const run = Background.parse(JSON.parse((await backendCall('GetBackground', { project, id })).json));
    run.phase ??= executionPhase(run.state, run.running);
    if (run.error) run.logTail = [run.error, run.logTail].filter(Boolean).join('\n');
    return run;
  } catch (error) {
    return {
      running: false,
      phase: 'unavailable',
      label: 'Backend unavailable',
      logTail: backendError(error),
    };
  }
}
/** Asks the backend to stop the task's active run. */
export async function stopBackgroundRun(project: string, id: string): Promise<Result<string>> {
  try {
    return { ok: true, value: (await backendCall('StopRun', { project, id })).text };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}
/** Records that nothing from the last run's uncertain cleanup still runs, so the task can run again. */
export async function confirmRunCleanup(project: string, id: string): Promise<Result<string>> {
  try {
    return { ok: true, value: (await backendCall('ConfirmCleanup', { project, id })).text };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}
/** Runs one tending pass over every open PR now: merges, CI and conflicts, instead of the next tick. */
export async function tendPullRequestsNow(project: string): Promise<Result<void>> {
  try {
    await backendCall('TendPullRequests', { project, id: '' });
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}
export async function clearBackgroundLog(project: string, id: string): Promise<void> {
  await backendCall('ClearLog', { project, id });
}
