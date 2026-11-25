import type { Metadata } from 'next';
import { TasksView } from '@/components/user-settings/views';
import { SettingsUnavailable } from '@/components/user-settings/unavailable';
import { userSettings } from '@/lib/user-settings';

export const metadata: Metadata = { title: 'Tasks' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const settings = await userSettings();
  if (!settings.ok) return <SettingsUnavailable title="Tasks" error={settings.error} />;
  return <TasksView initial={settings.value.tasks} />;
}
