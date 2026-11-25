import type { Metadata } from 'next';
import { PreferencesView } from '@/components/user-settings/views';
import { SettingsUnavailable } from '@/components/user-settings/unavailable';
import { userSettings } from '@/lib/user-settings';

export const metadata: Metadata = { title: 'Preferences' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const settings = await userSettings();
  if (!settings.ok) return <SettingsUnavailable title="Preferences" error={settings.error} />;
  return <PreferencesView initial={settings.value.preferences} />;
}
