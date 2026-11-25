import type { Metadata } from 'next';
import { ProfileView } from '@/components/user-settings/views';
import { SettingsUnavailable } from '@/components/user-settings/unavailable';
import { userEnvironment, userSettings } from '@/lib/user-settings';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const [settings, environment] = await Promise.all([userSettings(), userEnvironment()]);
  if (!settings.ok) return <SettingsUnavailable title="Profile" error={settings.error} />;
  return (
    <ProfileView
      initial={settings.value.identity}
      environment={environment.ok ? environment.value : undefined}
    />
  );
}
