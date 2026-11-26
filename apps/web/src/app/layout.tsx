import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { InboxNotifier } from '@/components/inbox-notifier';
import { UserPreferencesProvider } from '@/components/user-preferences';
import { DEFAULT_PREFERENCES } from '@/lib/user-preferences';
import { userSettings } from '@/lib/user-settings';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Harbor Lighthouse', template: '%s · Harbor Lighthouse' },
  description: 'Local task-to-pull-request factory',
  applicationName: 'Harbor Lighthouse',
};

// "System" follows the OS setting, which only the browser knows: set the class before first paint.
const SYSTEM_THEME = `(() => {
  const q = matchMedia('(prefers-color-scheme: dark)');
  const set = () => document.documentElement.classList.toggle('dark', q.matches);
  set();
  q.addEventListener('change', set);
})();`;

// `modal` holds route-backed dialogs (app/@modal); it renders nothing on other routes.
export default async function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  // The app still works on defaults when the backend is down.
  const saved = await userSettings();
  const prefs = saved.ok
    ? {
        identity: saved.value.identity,
        preferences: saved.value.preferences,
        tasks: saved.value.tasks,
        chat: saved.value.chat,
        notifications: saved.value.notifications,
      }
    : DEFAULT_PREFERENCES;
  const theme = prefs.preferences.theme;
  return (
    <html lang="en" className={theme === 'dark' ? 'dark' : undefined} suppressHydrationWarning>
      <head>{theme === 'system' && <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME }} />}</head>
      <body className="font-sans text-foreground antialiased">
        <UserPreferencesProvider value={prefs}>
          <InboxNotifier />
          <AppShell>
            {children}
            {modal}
          </AppShell>
        </UserPreferencesProvider>
      </body>
    </html>
  );
}
