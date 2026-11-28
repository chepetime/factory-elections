// The live system map behind /network: the web app, the CLI, the backend and its stores, the
// coding-agent CLIs and the Claude Code harness, with how busy each link is. `buildNetwork` is pure;
// `readNetwork` gathers its inputs on the server.
import 'server-only';
import { parseModelRef, type UserEnvironment } from '@factory/core';
import { listAgents } from '@/lib/agents';
import { listProjects, type Result } from '@/lib/factory';
import { readEngineHealth, type HealthState } from '@/lib/health';
import { listIssues } from '@/lib/issues';
import { listSpans, type ListedSpan } from '@/lib/system';
import { userEnvironment } from '@/lib/user-settings';

/** `limited`: it works, with a restriction its card explains. */
export type NodeStatus = 'ok' | 'working' | 'waiting' | 'limited' | 'error' | 'off' | 'unknown';
export type NodeKind = 'client' | 'cli' | 'backend' | 'data' | 'agent' | 'harness';
/** `unmeasured`: the link exists, but nothing records its traffic yet. */
export type EdgeStatus = 'live' | 'idle' | 'down' | 'unmeasured';

export interface NetworkNode {
  id: string;
  kind: NodeKind;
  name: string;
  /** One short line under the name. */
  detail: string;
  status: NodeStatus;
  /** The node's card: facts, one per line. */
  lines: string[];
}

export interface NetworkEdge {
  id: string;
  from: string;
  to: string;
  status: EdgeStatus;
  /** Calls over the link in the window; drives its width and moving dots. */
  calls: number;
  failed: number;
  label: string;
}

export interface NetworkSnapshot {
  at: string;
  /** Minutes the call counts cover. */
  windowMinutes: number;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

/** A run that works or waits right now, and the CLI that runs it. */
export interface BusyRun {
  project: string;
  key: string;
  provider: string;
  waiting: boolean;
}

export interface NetworkInput {
  health: HealthState;
  /** Absent while the CLI probe has not answered. */
  environment?: Result<UserEnvironment>;
  runs: BusyRun[];
  /** Model calls, newest first; only those inside the window count. */
  modelCalls: Pick<ListedSpan, 'provider' | 'started_at' | 'outcome'>[];
  now: number;
}

export const WINDOW_MINUTES = 10;

const AGENTS = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'pi', name: 'Pi' },
] as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildNetwork({ health, environment, runs, modelCalls, now }: NetworkInput): NetworkSnapshot {
  const up = health.status === 'ok';
  const h = up ? health.health : undefined;
  const since = now - WINDOW_MINUTES * 60_000;
  const recent = modelCalls.filter((call) => Date.parse(call.started_at) >= since);

  const nodes: NetworkNode[] = [
    {
      id: 'client',
      kind: 'client',
      name: 'Web app',
      detail: 'Next.js, this page',
      status: 'ok',
      lines: ['Reads the backend over gRPC from the server side.', 'This map asks it again every 5 seconds.'],
    },
    {
      id: 'cli',
      kind: 'cli',
      name: 'Factory CLI',
      detail: 'pnpm factory',
      status: 'unknown',
      lines: [
        'Uses the same gRPC client and token as the web app.',
        'The backend does not record which client called, so its traffic is not shown.',
      ],
    },
    {
      id: 'backend',
      kind: 'backend',
      name: 'Backend',
      detail: up ? 'gRPC 4319 · health 4318' : 'Not answering',
      status: !h ? 'error' : h.recovery?.state === 'degraded' ? 'waiting' : 'ok',
      lines: h
        ? [
            `Engine ${h.engine}.`,
            !h.recovery || h.recovery.state === 'ok'
              ? 'Startup recovery settled.'
              : h.recovery.state === 'pending'
                ? 'Startup recovery is still running.'
                : `Startup recovery left ${plural(h.recovery.problems, 'problem')}.`,
            `${plural(runs.filter((r) => !r.waiting).length, 'run')} working, ${runs.filter((r) => r.waiting).length} waiting for you.`,
          ]
        : ['The health check did not answer within 2 seconds.'],
    },
  ];

  const stores = h
    ? [
        ['Task store', h.task_store],
        ['Telemetry', h.telemetry_database],
        ...(h.artifact_store ? [['Artifacts', h.artifact_store] as const] : []),
      ]
    : [];
  const storeDown = stores.some(([, state]) => state === 'unavailable');
  nodes.push({
    id: 'data',
    kind: 'data',
    name: 'Data',
    detail: h ? (storeDown ? 'A store is unavailable' : 'Stores available') : 'Unknown',
    status: !h ? 'unknown' : storeDown ? 'error' : 'ok',
    lines: h
      ? stores.map(([name, state]) => `${name}: ${String(state).replace(/_/g, ' ')}.`)
      : ['Needs the backend.'],
  });

  const providers = environment?.ok ? environment.value.providers : undefined;
  for (const agent of AGENTS) {
    const probe = providers?.[agent.id];
    const mine = runs.filter((r) => r.provider === agent.id);
    const calls = recent.filter((c) => c.provider === agent.id);
    const status: NodeStatus = !probe
      ? 'unknown'
      : !probe.installed
        ? 'off'
        : mine.some((r) => !r.waiting)
          ? 'working'
          : mine.length
            ? 'waiting'
            : 'ok';
    nodes.push({
      id: agent.id,
      kind: 'agent',
      name: agent.name,
      detail: !probe
        ? 'Checking…'
        : !probe.installed
          ? 'Not installed'
          : mine.length
            ? `${plural(mine.length, 'run')} ${mine.some((r) => !r.waiting) ? 'working' : 'waiting'}`
            : probe.version
              ? `v${probe.version.replace(/^v/, '')}`
              : 'Installed',
      status,
      lines: [
        ...(probe?.version ? [`Version ${probe.version}.`] : []),
        ...(probe?.error ? [probe.error] : []),
        ...mine.map((r) => `${r.project} ${r.key}: ${r.waiting ? 'waiting for you' : 'working'}.`),
        `${plural(calls.length, 'model call')} in the last ${WINDOW_MINUTES} minutes.`,
      ],
    });
  }

  const hosted = h?.host_session === 'claude-code';
  nodes.push({
    id: 'harness',
    kind: 'harness',
    name: 'Harness',
    detail: hosted ? 'Started this stack' : 'Claude Code hooks and skills',
    status: hosted ? 'limited' : 'ok',
    lines: [
      'Session hooks, the factory-dev-loop skill and pnpm restart.',
      hosted
        ? 'The stack was started from a Claude Code session, so agent turns can inherit its permission limits.'
        : 'The stack was not started from a Claude Code session.',
    ],
  });

  const agentEdge = (id: string): NetworkEdge => {
    const node = nodes.find((n) => n.id === id)!;
    const calls = recent.filter((c) => c.provider === id);
    const failed = calls.filter((c) => c.outcome === 'failed').length;
    return {
      id: `backend-${id}`,
      from: 'backend',
      to: id,
      status:
        !up || node.status === 'off' || node.status === 'unknown'
          ? 'down'
          : calls.length || node.status === 'working'
            ? 'live'
            : 'idle',
      calls: calls.length,
      failed,
      label: `${plural(calls.length, 'model call')}${failed ? `, ${failed} failed` : ''}`,
    };
  };

  const edges: NetworkEdge[] = [
    {
      id: 'client-backend',
      from: 'client',
      to: 'backend',
      status: up ? 'live' : 'down',
      calls: 0,
      failed: 0,
      label: up ? 'gRPC, answering' : 'No answer',
    },
    {
      id: 'cli-backend',
      from: 'cli',
      to: 'backend',
      status: 'unmeasured',
      calls: 0,
      failed: 0,
      label: 'Not recorded',
    },
    {
      id: 'backend-data',
      from: 'backend',
      to: 'data',
      status: !h ? 'down' : storeDown ? 'down' : 'idle',
      calls: 0,
      failed: 0,
      label: storeDown ? 'A store is unavailable' : 'Postgres and files',
    },
    ...AGENTS.map((a) => agentEdge(a.id)),
    {
      id: 'harness-backend',
      from: 'harness',
      to: 'backend',
      status: hosted ? 'live' : 'unmeasured',
      calls: 0,
      failed: 0,
      label: hosted ? 'Started this stack' : 'Restarts the stack',
    },
  ];

  return { at: new Date(now).toISOString(), windowMinutes: WINDOW_MINUTES, nodes, edges };
}

/** The CLI probe spawns a process per CLI, so its answer is kept for a while. */
const ENVIRONMENT_TTL_MS = 5 * 60_000;
let environmentCache: { at: number; value: Promise<Result<UserEnvironment>> } | undefined;
function cachedEnvironment(now: number): Promise<Result<UserEnvironment>> {
  if (!environmentCache || now - environmentCache.at > ENVIRONMENT_TTL_MS) {
    // A failed probe is not kept: the next poll asks again.
    const value = userEnvironment().then((result) => {
      if (!result.ok) environmentCache = undefined;
      return result;
    });
    environmentCache = { at: now, value };
  }
  return environmentCache.value;
}

/** Busy runs over every project, with the CLI each one's agent uses. */
async function busyRuns(): Promise<BusyRun[]> {
  const [projects, agents] = await Promise.all([listProjects(), listAgents()]);
  if (!projects.ok) return [];
  const model = new Map((agents.ok ? agents.value : []).map((a) => [a.id, a.model]));
  const lists = await Promise.all(
    projects.value.map(async (p) => ({ project: p.name, list: await listIssues(p.name) })),
  );
  return lists.flatMap(({ project, list }) =>
    (list.ok ? list.value.items : []).flatMap((issue) => {
      const run = issue.run;
      if (!run || !(run.owned || run.waiting)) return [];
      const ref = issue.assignee ? model.get(issue.assignee) : undefined;
      return [
        {
          project,
          key: issue.key,
          provider: parseModelRef(ref ?? 'claude').provider,
          waiting: Boolean(run.waiting),
        },
      ];
    }),
  );
}

export async function readNetwork(now = Date.now()): Promise<NetworkSnapshot> {
  const [health, environment, runs, spans] = await Promise.all([
    readEngineHealth(),
    cachedEnvironment(now),
    busyRuns(),
    listSpans('model', 500, { days: 1 }),
  ]);
  return buildNetwork({ health, environment, runs, modelCalls: spans.ok ? spans.value.items : [], now });
}
