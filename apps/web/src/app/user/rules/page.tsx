import type { Metadata } from 'next';
import { RulesView } from '@/components/user-settings/views';
import { SettingsUnavailable } from '@/components/user-settings/unavailable';
import { userSettings } from '@/lib/user-settings';

export const metadata: Metadata = { title: 'Rules' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const settings = await userSettings();
  if (!settings.ok) return <SettingsUnavailable title="Rules" error={settings.error} />;
  return <RulesView initial={settings.value.rules} />;
}
