import type { Metadata } from 'next';
import { SystemStatus } from '@/components/system-status';
import { cliScript, dataRoot } from '@/lib/factory';

export const metadata: Metadata = { title: 'Settings · Software Factory' };
export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const rows = [
    ['Data root', dataRoot()],
    ['Factory CLI', cliScript() ?? 'Not configured'],
    ['Web app', 'http://localhost:3000 (local only)'],
    ['Engine health', 'http://127.0.0.1:4318/health'],
  ] as const;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">The state of this machine, the engine and your projects.</p>
      </div>

      <SystemStatus />

      <section aria-labelledby="workspace" className="rounded-2xl border bg-card p-5 shadow-xs">
        <h2 id="workspace" className="mb-3 text-base font-semibold">
          Workspace
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate font-mono text-xs leading-5" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Set <code className="font-mono">FACTORY_ROOT</code> to move the data root. Changes take effect after
          a restart.
        </p>
      </section>
    </div>
  );
}
