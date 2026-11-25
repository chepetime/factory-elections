import type { Metadata } from 'next';
import { NotificationsView } from '@/components/user-settings/views';
import { SettingsUnavailable } from '@/components/user-settings/unavailable';
import { userSettings } from '@/lib/user-settings';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const settings = await userSettings();
  if (!settings.ok) return <SettingsUnavailable title="Notifications" error={settings.error} />;
  return <NotificationsView initial={settings.value.notifications} />;
}
