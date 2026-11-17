// Server-only: runs every settings-page check. Environment checks come from `factory doctor`;
// the engine checks read the health server; each project gets `factory profile check`.
import 'server-only';
import { cliScript, listProjects, runCli } from '@/lib/factory';
import { readEngineHealth } from '@/lib/health';
import { parseDoctor, type StatusCheck, type StatusReport } from '@/lib/status-checks';

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.trim().replace(/^error:\s*/, ''))
      .find(Boolean) ?? ''
  );
}

async function environment(): Promise<StatusCheck[]> {
  const out = await runCli(['doctor'], 30_000);
  if (!out)
    return [
      {
        id: 'env-cli',
        group: 'Environment',
        name: 'Factory CLI',
        status: 'fail',
        detail: 'Not configured',
        fix: 'Set FACTORY_CLI_SCRIPT to the absolute path of bin/factory, or start the app with `pnpm web`.',
      },
    ];
  const checks = parseDoctor(out.stdout);
  if (checks.length === 0)
    return [
      {
        id: 'env-doctor',
        group: 'Environment',
        name: 'factory doctor',
        status: 'fail',
        detail: firstLine(out.stderr) || `Exited with code ${out.code}`,
      },
    ];
  return checks;
}

async function engine(): Promise<StatusCheck[]> {
  const health = await readEngineHealth();
  const checks: StatusCheck[] = [
    {
      id: 'engine-cli',
      group: 'Engine',
      name: 'Web app → CLI',
      status: cliScript() ? 'ok' : 'fail',
      detail: cliScript()
        ? 'The web app can run factory commands'
        : 'FACTORY_CLI_SCRIPT is not an absolute path',
    },
  ];
  if (health.status === 'unavailable') {
    checks.push({
      id: 'engine-health',
      group: 'Engine',
      name: 'Health server',
      status: 'fail',
      detail: 'Not reachable on 127.0.0.1:4318',
      fix: 'Start it with `factory serve`, or run the app with `pnpm web`.',
    });
    return checks;
  }
  const store = health.health.task_store;
  checks.push(
    {
      id: 'engine-health',
      group: 'Engine',
      name: 'Health server',
      status: 'ok',
      detail: 'Running on 127.0.0.1:4318',
    },
    {
      id: 'engine-store',
      group: 'Engine',
      name: 'Task store',
      status: store === 'available' ? 'ok' : store === 'not_initialized' ? 'warn' : 'fail',
      detail:
        store === 'available'
          ? 'Available'
          : store === 'not_initialized'
            ? 'Not initialized yet'
            : 'Unavailable',
      fix: store === 'available' ? undefined : 'Register a project with `factory project add`.',
    },
    {
      id: 'engine-integrations',
      group: 'Engine',
      name: 'Integrations',
      status: 'ok',
      detail: health.health.integrations.length
        ? `${health.health.integrations.length} configured`
        : 'None configured',
    },
  );
  return checks;
}

async function projects(): Promise<StatusCheck[]> {
  const list = await listProjects();
  if (!list.ok)
    return [{ id: 'projects', group: 'Projects', name: 'Projects', status: 'fail', detail: list.error }];
  if (list.value.length === 0)
    return [
      {
        id: 'projects',
        group: 'Projects',
        name: 'Projects',
        status: 'warn',
        detail: 'No projects registered',
        fix: 'Register one with `factory project add --name <name> --repo <path>`.',
      },
    ];
  return Promise.all(
    list.value.map(async (p): Promise<StatusCheck> => {
      const out = await runCli(['profile', 'check', '--project', p.name], 30_000);
      const ok = out?.code === 0;
      return {
        id: `project-${p.name}`,
        group: 'Projects',
        name: p.name,
        status: ok ? 'ok' : 'fail',
        detail: ok ? `Profile approved · ${p.repo}` : firstLine(out?.stderr ?? '') || 'Profile check failed',
        fix: ok
          ? undefined
          : `Run \`factory profile init --project ${p.name}\`, review the draft, then approve it.`,
      };
    }),
  );
}

export async function systemStatus(): Promise<StatusReport> {
  const groups = await Promise.all([environment(), engine(), projects()]);
  return { checkedAt: new Date().toISOString(), checks: groups.flat() };
}
