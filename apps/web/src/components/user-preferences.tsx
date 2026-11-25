'use client';
// The user settings that change how the app behaves in the browser: time zone, task composer and chat
// defaults, and notifications. The root layout reads them on the server and provides them here.
import { createContext, useContext, type ReactNode } from 'react';
import type { UserSettings } from '@factory/core';

export type UserPreferences = Pick<
  UserSettings,
  'identity' | 'preferences' | 'tasks' | 'chat' | 'notifications'
>;

export const DEFAULT_PREFERENCES: UserPreferences = {
  identity: { emails: [] },
  preferences: { theme: 'light' },
  tasks: { default_type: 'work', start_runs: false, jira_key_field: true },
  chat: { approval_mode: 'request' },
  notifications: { browser: false, muted: [] },
};

const Context = createContext<UserPreferences>(DEFAULT_PREFERENCES);

export function UserPreferencesProvider({
  value,
  children,
}: {
  value: UserPreferences;
  children: ReactNode;
}) {
  return <Context value={value}>{children}</Context>;
}

export function useUserPreferences(): UserPreferences {
  return useContext(Context);
}
