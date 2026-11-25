import type { Metadata } from 'next';
import { ChatView } from '@/components/user-settings/views';
import { SettingsUnavailable } from '@/components/user-settings/unavailable';
import { userSettings } from '@/lib/user-settings';

export const metadata: Metadata = { title: 'Chat' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const settings = await userSettings();
  if (!settings.ok) return <SettingsUnavailable title="Chat" error={settings.error} />;
  return <ChatView initial={settings.value.chat} />;
}
