// The Functions and System pages read their data through the backend RPCs and show it, or say why not.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend-client';
import FindingsPage from '@/app/findings/page';
import LlmCallsPage from '@/app/llm-calls/page';
import SkillsPage from '@/app/system/skills/page';
import ToolsPage from '@/app/system/tools/page';
import ToolCallsPage from '@/app/tool-calls/page';
import TrafficPage from '@/app/traffic/page';

vi.mock('@factory/backend-client', () => ({ backendCall: vi.fn() }));
vi.mock('@/components/local-time', () => ({ LocalTime: ({ iso }: { iso?: string }) => <time>{iso}</time> }));
const rpc = vi.mocked(backendCall);
const reply = (value: unknown) => ({ json: JSON.stringify(value) });
afterEach(() => vi.clearAllMocks());

const span = (over: Record<string, unknown>) => ({
  trace_id: 't',
  span_id: String(Math.random()),
  type: 'tool',
  name: 'Bash',
  project: 'demo',
  started_at: '2026-11-26T10:00:00.000Z',
  ended_at: '2026-11-26T10:00:01.000Z',
  duration_ms: 1500,
  outcome: 'completed',
  ...over,
});

it('lists tool calls with their input, a link to the run trace, and the failed count', async () => {
  rpc.mockResolvedValue(
    reply({
      since: '2026-11-12T00:00:00.000Z',
      total: 2,
      failed: 1,
      items: [
        span({
          task_id: '11111111-1111-4111-8111-111111111111',
          step: 'coder',
          attributes: { input: 'pnpm test' },
        }),
        span({ name: 'Read', outcome: 'failed', error: 'No such file' }),
      ],
    }),
  );
  const html = renderToStaticMarkup(await ToolCallsPage());
  expect(rpc).toHaveBeenCalledWith('ListSpans', {
    project: '',
    json: JSON.stringify({ type: 'tool', limit: 200 }),
  });
  expect(html).toContain('pnpm test');
  expect(html).toContain('href="/projects/demo/tasks/11111111-1111-4111-8111-111111111111/trace"');
  expect(html).toContain('demo · coder');
  expect(html).toContain('1.5 s');
  expect(html).toContain('No such file');
  expect(html).toMatch(/Failed<\/p><p[^>]*>1</);
});

it('lists model calls with tokens and cost, and says when a cost is unknown', async () => {
  rpc.mockResolvedValue(
    reply({
      since: 'x',
      total: 2,
      failed: 0,
      items: [
        span({
          type: 'model',
          name: 'claude',
          model: 'claude-sonnet-5-5',
          step: 'coder',
          cost_usd: 0.42,
          tokens: { input: 12000, output: 800 },
        }),
        span({ type: 'model', name: 'codex', cost_usd: null }),
      ],
    }),
  );
  const html = renderToStaticMarkup(await LlmCallsPage());
  expect(html).toContain('claude-sonnet-5-5');
  expect(html).toContain('12.0k / 800');
  expect(html).toContain('$0.42');
  expect(html).toContain('1 without a reported cost');
  expect(html).toContain('>unknown<');
});

it('groups findings by PR, sorts them by severity, and filters by severity', async () => {
  const row = (index: number, severity: string, number = 4) => ({
    project: 'demo',
    number,
    index,
    title: `PR ${number}`,
    url: 'u',
    at: '2026-11-26T00:00:00.000Z',
    severity,
    finding: `Finding ${index}`,
  });
  rpc.mockResolvedValue(reply([row(0, 'should-fix'), row(1, 'critical'), row(0, 'must-fix', 5)]));
  const html = renderToStaticMarkup(await FindingsPage({}));
  expect(rpc).toHaveBeenCalledWith('ListFindings', { project: '', id: '' });
  expect(html).toContain('href="/projects/demo/reviews/4"');
  expect(html.indexOf('Finding 1')).toBeLessThan(html.indexOf('Finding 0'));
  expect(html).toMatch(/All <span[^>]*>3</);
  const only = renderToStaticMarkup(
    await FindingsPage({ searchParams: Promise.resolve({ severity: 'must-fix' }) }),
  );
  expect(only).toContain('PR 5');
  expect(only).not.toContain('href="/projects/demo/reviews/4"');
});

it('shows traffic totals, a bar per day, and breakdowns by model', async () => {
  const sum = {
    cost_usd: 3,
    unknown_cost_spans: 0,
    tokens: { input: 1000, output: 500, cache_read: 0, cache_write: 0 },
  };
  rpc.mockResolvedValue(
    reply({
      from: '2026-11-12T00:00:00.000Z',
      to: '2026-11-26T00:00:00.000Z',
      total: { ...sum, spans: 9 },
      days: [{ ...sum, day: '2026-11-20' }],
      by_model: { 'claude-sonnet-5-5': sum },
      by_project: { demo: sum },
      by_step: {},
      by_type: { model: { ...sum, spans: 3 } },
      runs: { count: 4, failed: 1 },
      reliability: { stalls: 0, repeat_loops: 0, failed_tool_calls: 2, tool_calls: 20 },
      prs: { count: 1, cost_usd: 3 },
    }),
  );
  const html = renderToStaticMarkup(await TrafficPage());
  expect(html).toContain('$3.00');
  expect(html).toContain('1.5k');
  expect(html).toContain('aria-label="2026-11-20: $3.00, 1.5k tokens"');
  expect(html).toContain('claude-sonnet-5-5');
  expect(html).toContain('2 failed');
});

it('lists factory and built-in tools with usage, and skills by owner', async () => {
  rpc.mockResolvedValue(
    reply({
      usage_days: 14,
      mcp: [{ name: 'factory', transport: 'HTTP', description: 'd', tools: ['delegate'] }],
      external_mcp: [],
      tools: [
        {
          name: 'comment',
          description: 'Comment',
          source: 'factory',
          when: 'An agent working a task',
          calls: 3,
          failed: 0,
        },
        {
          name: 'Bash',
          description: 'Run',
          source: 'built-in',
          when: 'Steps with edit access',
          calls: 5,
          failed: 2,
        },
      ],
      skills: [
        { name: 'senior-pr-review', description: 'Review', owner: 'factory', path: '/a', version: '4.0.3' },
        { name: 'tdd', description: 'Test first', owner: 'demo', path: '/b' },
      ],
    }),
  );
  const tools = renderToStaticMarkup(await ToolsPage());
  expect(tools.indexOf('>comment<')).toBeLessThan(tools.indexOf('>Built-in tools</h2>'));
  expect(tools).toContain('(2 failed)');
  const skills = renderToStaticMarkup(await SkillsPage());
  expect(skills).toMatch(/Factory[\s\S]*senior-pr-review[\s\S]*v4\.0\.3[\s\S]*demo[\s\S]*tdd/);
});

it('says why a page has no data when the backend fails', async () => {
  rpc.mockRejectedValue(new Error('backend down'));
  expect(renderToStaticMarkup(await ToolCallsPage())).toContain('Tool calls unavailable: backend down');
  expect(renderToStaticMarkup(await SkillsPage())).toContain('Skills unavailable: backend down');
});
