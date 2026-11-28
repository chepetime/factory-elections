import { describe, expect, it } from 'vitest';
import type { EngineHealth } from '@/lib/health';
import { buildNetwork, type NetworkInput } from '@/lib/network';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const engine: EngineHealth = {
  engine: 'running',
  task_store: 'available',
  telemetry_database: 'available',
  ledger: { unknown_cost_spans: 0, missing_parent_links: 0, write_errors: 0 },
  recovery: { state: 'ok', problems: 0 },
  integrations: [],
};
const health: NetworkInput['health'] = { status: 'ok', health: engine };
const installed = { installed: true, version: '2.1.0', models: [], checks: [] };
const environment: NetworkInput['environment'] = {
  ok: true,
  value: {
    git: { project_emails: [] },
    github: {},
    providers: { claude: installed, codex: installed, pi: { installed: false, models: [], checks: [] } },
  },
};

const build = (input: Partial<NetworkInput> = {}) =>
  buildNetwork({ health, environment, runs: [], modelCalls: [], now: NOW, ...input });
const node = (snapshot: ReturnType<typeof build>, id: string) => snapshot.nodes.find((n) => n.id === id)!;
const edge = (snapshot: ReturnType<typeof build>, id: string) => snapshot.edges.find((e) => e.id === id)!;

describe('buildNetwork', () => {
  it('maps every part of the installation and the links between them', () => {
    const snapshot = build();
    expect(snapshot.nodes.map((n) => n.id)).toEqual([
      'client',
      'cli',
      'backend',
      'data',
      'claude',
      'codex',
      'pi',
      'harness',
    ]);
    expect(edge(snapshot, 'client-backend').status).toBe('live');
    // Nothing records CLI traffic, so the map says so instead of drawing it idle.
    expect(edge(snapshot, 'cli-backend').status).toBe('unmeasured');
    expect(node(snapshot, 'pi')).toMatchObject({ status: 'off', detail: 'Not installed' });
    expect(edge(snapshot, 'backend-pi')).toMatchObject({ status: 'down', label: '0 model calls' });
  });

  it('shows installed Pi and counts its calls', () => {
    const snapshot = build({
      environment: {
        ...environment,
        value: {
          ...environment.value,
          providers: { ...environment.value.providers, pi: installed },
        },
      },
      modelCalls: [{ provider: 'pi', started_at: minutesAgo(1), outcome: 'completed' }],
    });
    expect(node(snapshot, 'pi')).toMatchObject({ status: 'ok', detail: 'v2.1.0' });
    expect(edge(snapshot, 'backend-pi')).toMatchObject({ status: 'live', calls: 1 });
  });

  it('counts model calls per CLI inside the window only, with their failures', () => {
    const snapshot = build({
      modelCalls: [
        { provider: 'claude', started_at: minutesAgo(1), outcome: 'completed' },
        { provider: 'claude', started_at: minutesAgo(3), outcome: 'failed' },
        { provider: 'claude', started_at: minutesAgo(30), outcome: 'completed' },
        { provider: 'codex', started_at: minutesAgo(2), outcome: 'completed' },
      ],
    });
    expect(edge(snapshot, 'backend-claude')).toMatchObject({ status: 'live', calls: 2, failed: 1 });
    expect(edge(snapshot, 'backend-claude').label).toBe('2 model calls, 1 failed');
    expect(edge(snapshot, 'backend-codex')).toMatchObject({ status: 'live', calls: 1 });
  });

  it('shows working and waiting runs on the CLI that runs them', () => {
    const snapshot = build({
      runs: [
        { project: 'demo', key: 'DE-1', provider: 'claude', waiting: false },
        { project: 'demo', key: 'DE-2', provider: 'codex', waiting: true },
      ],
    });
    expect(node(snapshot, 'claude')).toMatchObject({ status: 'working', detail: '1 run working' });
    expect(node(snapshot, 'codex')).toMatchObject({ status: 'waiting' });
    expect(node(snapshot, 'backend').lines).toContain('1 run working, 1 waiting for you.');
  });

  it('turns the backend and its links red when health does not answer', () => {
    const snapshot = build({ health: { status: 'unavailable' } });
    expect(node(snapshot, 'backend').status).toBe('error');
    expect(node(snapshot, 'data').status).toBe('unknown');
    expect(edge(snapshot, 'client-backend').status).toBe('down');
    expect(edge(snapshot, 'backend-claude').status).toBe('down');
  });

  it('flags a stack that a Claude Code session started', () => {
    const hosted = build({
      health: {
        status: 'ok',
        health: { ...engine, host_session: 'claude-code' },
      },
    });
    expect(node(hosted, 'harness').status).toBe('limited');
    expect(edge(hosted, 'harness-backend').status).toBe('live');
    expect(node(build(), 'harness').status).toBe('ok');
  });
});
