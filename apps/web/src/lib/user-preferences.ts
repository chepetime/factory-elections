// The defaults the app uses when the backend cannot give the user's settings. A plain module, not a
// client one: the root layout reads these values on the server, where a 'use client' export is
// only a reference.
import type { UserSettings } from '@factory/core';

export type UserPreferences = Pick<
  UserSettings,
  'identity' | 'preferences' | 'tasks' | 'chat' | 'notifications'
>;

export const DEFAULT_PREFERENCES: UserPreferences = {
  identity: { emails: [] },
  preferences: { theme: 'light' },
  tasks: { default_type: 'work', start_runs: false, jira_key_field: true, details_pane: true },
  chat: { approval_mode: 'request' },
  notifications: { browser: false, muted: [] },
};
