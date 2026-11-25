import type { Metadata } from 'next';
import { UserSettingsForm } from '@/components/user-settings-form';
import { userEnvironment, userSettings } from '@/lib/user-settings';

export const metadata: Metadata = { title: 'User settings' };
export const dynamic = 'force-dynamic';

/** The person who runs this factory: identity, agent providers and models, and global rules. */
export default async function UserPage() {
  const [settings, environment] = await Promise.all([userSettings(), userEnvironment()]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">User settings</h1>
      <p className="text-sm text-muted-foreground">
        Who you are, which agents the factory may use, and rules every agent follows in every project.
      </p>
      {!settings.ok ? (
        <p className="mt-6 text-sm text-destructive">User settings unavailable: {settings.error}</p>
      ) : (
        <UserSettingsForm
          initial={settings.value}
          environment={environment.ok ? environment.value : undefined}
          environmentError={environment.ok ? undefined : environment.error}
        />
      )}
    </div>
  );
}
