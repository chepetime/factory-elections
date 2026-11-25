import type { Metadata } from 'next';
import { ProvidersView } from '@/components/user-settings/providers-view';
import { SettingsUnavailable } from '@/components/user-settings/unavailable';
import { userEnvironment, userSettings } from '@/lib/user-settings';

export const metadata: Metadata = { title: 'Providers and models' };
export const dynamic = 'force-dynamic';

export default async function ProvidersPage() {
  const [settings, environment] = await Promise.all([userSettings(), userEnvironment()]);
  if (!settings.ok) return <SettingsUnavailable title="Providers and models" error={settings.error} />;
  return (
    <ProvidersView
      initial={settings.value.providers}
      environment={environment.ok ? environment.value : undefined}
      environmentError={environment.ok ? undefined : environment.error}
    />
  );
}
