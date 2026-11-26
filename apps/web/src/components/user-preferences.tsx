'use client';
// The user settings that change how the app behaves in the browser: time zone, task composer and chat
// defaults, and notifications. The root layout reads them on the server and provides them here.
import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_PREFERENCES, type UserPreferences } from '@/lib/user-preferences';

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
