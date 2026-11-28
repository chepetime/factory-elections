// Server-only typed bridge for user settings and the machine's CLIs. Storage and detection belong
// to the backend.
import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend-client';
import { ProviderCheck, UserEnvironment, UserSettings } from '@factory/core';
import { backendError, type Result } from '@/lib/factory';
import { cache } from 'react';
export type { ProviderCheck, UserEnvironment, UserSettings };

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

function userSettingsUncached(): Promise<Result<UserSettings>> {
  return attempt(async () => UserSettings.parse(JSON.parse((await backendCall('GetUserSettings', {})).json)));
}
export function saveUserSettingsRun(settings: unknown): Promise<Result<UserSettings>> {
  return attempt(async () =>
    UserSettings.parse(
      JSON.parse((await backendCall('SaveUserSettings', { json: JSON.stringify(settings) })).json),
    ),
  );
}
/** The "responds" check: a real one-word model call, so only ever from an explicit Test click. */
export function testProviderRun(provider: string): Promise<Result<ProviderCheck>> {
  return attempt(async () =>
    ProviderCheck.parse(JSON.parse((await backendCall('TestProvider', { provider }, 90_000)).json)),
  );
}
export function userEnvironment(): Promise<Result<UserEnvironment>> {
  return attempt(async () =>
    UserEnvironment.parse(JSON.parse((await backendCall('GetUserEnvironment', {})).json)),
  );
}

// One read per server render: the page, its layouts and generateMetadata share the result.
// Outside a render (server actions, route handlers) `cache` calls straight through.
export const userSettings = cache(userSettingsUncached);
