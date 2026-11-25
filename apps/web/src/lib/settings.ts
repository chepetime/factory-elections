// Server-only typed bridge for project settings. Storage and the exploring agent belong to the backend.
import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend/client';
import { ProjectSettings, TaskManager } from '@factory/core';
import { backendError, type Result } from '@/lib/factory';
export type { ProjectSettings };

export const SettingsProposal = z.object({
  display_name: z.string(),
  icon: z.string(),
  task_manager: TaskManager,
  summary: z.string(),
  evidence: z.array(z.string()),
});
export type SettingsProposal = z.infer<typeof SettingsProposal>;

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

export function projectSettings(project: string): Promise<Result<ProjectSettings>> {
  return attempt(async () =>
    ProjectSettings.parse(JSON.parse((await backendCall('GetProjectSettings', { project })).json)),
  );
}
export function saveProjectSettingsRun(project: string, settings: unknown): Promise<Result<ProjectSettings>> {
  return attempt(async () =>
    ProjectSettings.parse(
      JSON.parse(
        (await backendCall('SaveProjectSettings', { project, json: JSON.stringify(settings) })).json,
      ),
    ),
  );
}
/** Exploration reads the repository with a model; allow it several minutes. */
export function detectProjectSettingsRun(project: string): Promise<Result<SettingsProposal>> {
  return attempt(async () =>
    SettingsProposal.parse(
      JSON.parse((await backendCall('DetectProjectSettings', { project }, 660_000)).json),
    ),
  );
}

export const ProfileStatus = z.discriminatedUnion('state', [
  z.object({ state: z.literal('missing'), path: z.string() }),
  z.object({ state: z.literal('draft'), path: z.string() }),
  z.object({ state: z.literal('approved'), path: z.string(), approved_at: z.string() }),
  z.object({ state: z.literal('invalid'), path: z.string(), error: z.string() }),
]);
export type ProfileStatus = z.infer<typeof ProfileStatus>;
export function profileStatus(project: string): Promise<Result<ProfileStatus>> {
  return attempt(async () =>
    ProfileStatus.parse(JSON.parse((await backendCall('GetProfileStatus', { project })).json)),
  );
}
/** Drafts the repo profile if it is missing; an existing one is never changed. */
export function draftProfileRun(project: string): Promise<Result<ProfileStatus>> {
  return attempt(async () =>
    ProfileStatus.parse(JSON.parse((await backendCall('DraftProfile', { project })).json)),
  );
}
