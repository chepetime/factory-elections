import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend-client';
import { featureActions, Ticket, type FeatureFacts, type FeatureStage } from '@factory/core';
import FeaturePage from '@/app/projects/[project]/features/[id]/page';

vi.mock('@factory/backend-client', () => ({ backendCall: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('not found');
  },
}));
const rpc = vi.mocked(backendCall);
afterEach(() => vi.clearAllMocks());

const ticket = (id: string, over: Partial<Ticket> = {}) =>
  Ticket.parse({ id, title: `Ticket ${id}`, description: 'd', acceptance: ['a'], size: 'S', ...over });
/** The page as the backend would describe a feature: its actions come from the shared policy. */
async function page(
  stage: FeatureStage,
  over: Partial<FeatureFacts> & { spec?: string; qa?: string; busy?: boolean; error?: string } = {},
) {
  const { busy = false, ...rest } = over;
  const facts = { stage, grill: { turns: [] }, tickets: [], has_spec: Boolean(over.spec), ...rest };
  rpc.mockResolvedValue({
    json: JSON.stringify({
      id: 'feature-one',
      title: 'Save a ballot',
      ...facts,
      ...(busy ? { working: { action: 'plan' } } : {}),
      actions: featureActions(facts, busy),
    }),
  });
  const html = renderToStaticMarkup(
    await FeaturePage({ params: Promise.resolve({ project: 'demo', id: 'feature-one' }) }),
  );
  return { html, sends: [...html.matchAll(/name="action" value="([a-z-]+)"/g)].map((m) => m[1]) };
}

it('offers the commands the backend accepts in each stage, and no others', async () => {
  const question = { turns: [{ at: 'now', role: 'agent' as const, text: 'Q1: who uses it?' }] };
  const asked = await page('grilling', { grill: question });
  expect(asked.html).toContain('Q1: who uses it?');
  expect(asked.html).toContain('name="text"');
  expect(asked.sends).toEqual(['grill', 'skip-grill', 'write-spec', 'cancel']);

  expect((await page('spec', { spec: '# Spec' })).sends).toEqual([
    'approve-spec',
    'write-spec',
    'save-spec',
    'cancel',
  ]);
  expect((await page('spec')).sends).toEqual(['write-spec', 'cancel']);
  expect((await page('spec-approved', { spec: '# Spec' })).sends).toEqual(['save-spec', 'plan', 'cancel']);
  expect((await page('board', { tickets: [ticket('T1')] })).sends).toEqual([
    'save-board',
    'approve-board',
    'plan',
    'cancel',
  ]);
  const board = await page('board', { tickets: [ticket('T1')] });
  expect(board.html).toContain('aria-label="T1 title"');
  expect(board.html).toContain('name="tickets"');

  const work = await page('implementing', {
    tickets: [
      ticket('T1', { state: 'failed', task_id: 'a', error: 'Checks failed' }),
      ticket('T2', { state: 'waiting-merge', blocked_by: ['T1', 'T3'] }),
      ticket('T3', { state: 'running', task_id: 'b' }),
    ],
  });
  expect(work.sends).toEqual(['retry-ticket', 'mark-merged', 'write-qa', 'cancel']);
  expect(work.html).toContain('Checks failed');
  expect(work.html).toContain('name="ticket" value="T1"');

  const qa = await page('qa', { qa: '# QA plan' });
  expect(qa.html).toContain('# QA plan');
  expect(qa.sends).toEqual(['complete', 'write-qa', 'cancel']);
});

it('shows no command for an ended feature, and only cancel while an agent step runs', async () => {
  expect((await page('done', { qa: '# QA plan' })).sends).toEqual([]);
  expect((await page('cancelled')).sends).toEqual([]);
  const busy = await page('spec-approved', { spec: '# Spec', busy: true });
  expect(busy.sends).toEqual(['cancel']);
  expect(busy.html).toContain('The agent plans the board');
});
