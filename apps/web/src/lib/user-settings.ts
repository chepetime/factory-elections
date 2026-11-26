// Server-only typed bridge for user settings and the machine's CLIs. Storage and detection belong
// to the backend.
import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend-client';
import { UserEnvironment, UserSettings } from '@factory/core';
import { backendError, type Result } from '@/lib/factory';
export type { UserEnvironment, UserSettings };

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

export function userSettings(): Promise<Result<UserSettings>> {
  return attempt(async () => UserSettings.parse(JSON.parse((await backendCall('GetUserSettings', {})).json)));
}
export function saveUserSettingsRun(settings: unknown): Promise<Result<UserSettings>> {
  return attempt(async () =>
    UserSettings.parse(
      JSON.parse((await backendCall('SaveUserSettings', { json: JSON.stringify(settings) })).json),
    ),
  );
}
export function userEnvironment(): Promise<Result<UserEnvironment>> {
  return attempt(async () =>
    UserEnvironment.parse(JSON.parse((await backendCall('GetUserEnvironment', {})).json)),
  );
}
