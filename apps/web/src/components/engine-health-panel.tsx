import { readEngineHealth, type HealthState } from '@/lib/health';

const STORE: Record<string, string> = {
  available: 'Available',
  not_initialized: 'Not initialized',
  unavailable: 'Unavailable',
};

export function EngineHealthView({ state }: { state: HealthState }) {
  return (
    <section aria-labelledby="engine-health" className="rounded-xl border p-4">
      <h2 id="engine-health" className="mb-2 font-medium">
        Engine health
      </h2>
      {state.status === 'unavailable' ? (
        <p className="text-sm text-destructive">Engine unavailable</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Engine</dt>
          <dd>Running</dd>
          <dt className="text-muted-foreground">Task store</dt>
          <dd>{STORE[state.health.task_store]}</dd>
          <dt className="text-muted-foreground">Telemetry database</dt>
          <dd>
            {state.health.telemetry_database === 'not_configured'
              ? 'Not configured'
              : STORE[state.health.telemetry_database]}
          </dd>
          {state.health.artifact_store && (
            <>
              <dt className="text-muted-foreground">Artifact storage</dt>
              <dd>{STORE[state.health.artifact_store]}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Integrations</dt>
          <dd>No integrations configured</dd>
        </dl>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Reports the <code>factory serve</code> process, not model availability.
      </p>
    </section>
  );
}

export async function EngineHealthPanel() {
  return <EngineHealthView state={await readEngineHealth()} />;
}
