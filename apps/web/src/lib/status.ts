// The backend owns environment/profile checks; Next.js renders their validated results.
import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend-client';
import { backendError } from '@/lib/factory';
import { readEngineHealth } from '@/lib/health';
import type { StatusCheck, StatusReport } from '@/lib/status-checks';

const Diagnostics = z.object({
  checked_at: z.string(),
  data_root: z.string(),
  environment: z.array(
    z.object({ name: z.string(), ok: z.boolean(), detail: z.string(), fix: z.string().optional() }),
  ),
  profiles: z.array(
    z.object({ name: z.string(), repo: z.string(), approved: z.boolean(), error: z.string().optional() }),
  ),
});
export async function systemStatus(): Promise<StatusReport> {
  const [health, diagnostics] = await Promise.all([
    readEngineHealth(),
    backendCall('GetDiagnostics', {}, 30_000).then(
      (reply) => {
        try {
          return { ok: true as const, value: Diagnostics.parse(JSON.parse(reply.json)) };
        } catch (error) {
          return { ok: false as const, error: backendError(error) };
        }
      },
      (error) => ({ ok: false as const, error: backendError(error) }),
    ),
  ]);
  const checks: StatusCheck[] = [
    {
      id: 'engine-backend',
      group: 'Engine',
      name: 'Web app → backend (gRPC)',
      status: diagnostics.ok ? 'ok' : 'fail',
      detail: diagnostics.ok ? 'Authenticated local connection' : diagnostics.error,
    },
  ];
  checks.push({
    id: 'engine-health',
    group: 'Engine',
    name: 'Health server',
    status: health.status === 'ok' ? 'ok' : 'fail',
    detail: health.status === 'ok' ? 'Running' : 'Unavailable',
    fix: health.status === 'ok' ? undefined : 'Start `pnpm backend` or `pnpm web`.',
  });
  if (health.status === 'ok') {
    const store = health.health.task_store;
    if (health.health.telemetry_database !== 'not_configured')
      checks.push({
        id: 'engine-postgres',
        group: 'Engine',
        name: 'Postgres',
        status: health.health.telemetry_database === 'available' ? 'ok' : 'fail',
        detail: health.health.telemetry_database,
      });
    if (health.health.artifact_store)
      checks.push({
        id: 'engine-artifacts',
        group: 'Engine',
        name: 'S3 artifact storage',
        status: health.health.artifact_store === 'available' ? 'ok' : 'fail',
        detail: health.health.artifact_store,
      });
    checks.push({
      id: 'engine-store',
      group: 'Engine',
      name: 'Task store',
      status: store === 'available' ? 'ok' : store === 'not_initialized' ? 'warn' : 'fail',
      detail: store,
    });
    const recovery = health.health.recovery;
    if (recovery)
      checks.push({
        id: 'engine-recovery',
        group: 'Engine',
        name: 'Recovery after restart',
        status: recovery.state === 'ok' ? 'ok' : recovery.state === 'pending' ? 'warn' : 'fail',
        detail:
          recovery.state === 'degraded'
            ? `${recovery.problems} ${recovery.problems === 1 ? 'item' : 'items'} could not be read`
            : recovery.state === 'pending'
              ? 'Running'
              : 'Settled',
        fix:
          recovery.state === 'degraded'
            ? 'Open the inbox for each item; fix the storage error and the backend retries on its own.'
            : undefined,
      });
    checks.push({
      id: 'engine-integrations',
      group: 'Engine',
      name: 'Integrations',
      status: 'ok',
      detail: health.health.integrations.length
        ? `${health.health.integrations.length} configured`
        : 'None configured',
    });
  }
  if (diagnostics.ok) {
    checks.push(
      ...diagnostics.value.environment.map((c): StatusCheck => ({
        id: `env-${c.name.toLowerCase().replace(/\W+/g, '-')}`,
        group: 'Environment',
        name: c.name,
        status: c.ok ? 'ok' : 'fail',
        detail: c.detail,
        fix: c.ok ? undefined : c.fix,
      })),
    );
    checks.push(
      ...diagnostics.value.profiles.map((p): StatusCheck => ({
        id: `project-${p.name}`,
        group: 'Projects',
        name: p.name,
        status: p.approved ? 'ok' : 'fail',
        detail: p.approved ? `Profile approved · ${p.repo}` : (p.error ?? 'Profile check failed'),
        fix: p.approved ? undefined : `Review and approve the profile for ${p.name}.`,
      })),
    );
    if (!diagnostics.value.profiles.length)
      checks.push({
        id: 'projects',
        group: 'Projects',
        name: 'Projects',
        status: 'warn',
        detail: 'No projects registered',
        fix: 'Add one on the Projects page (/projects) or with `factory project add`.',
      });
  }
  return { checkedAt: diagnostics.ok ? diagnostics.value.checked_at : new Date().toISOString(), checks };
}
