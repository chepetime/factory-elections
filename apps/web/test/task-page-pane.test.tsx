import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserSettings } from '@factory/core';
import TaskPage from '@/app/projects/[project]/tasks/[id]/page';
import { readDiff } from '@/lib/factory';
import { getIssue } from '@/lib/issues';
import { readRunSession } from '@/lib/run-session';
import { listSpans } from '@/lib/system';
import { userSettings } from '@/lib/user-settings';

vi.mock('@/lib/factory', () => ({
  readDiff: vi.fn(),
  isProjectName: () => true,
  isTaskId: () => false,
  showTask: vi.fn(async () => ({ ok: false, error: 'not loaded in this test' })),
}));
vi.mock('@/lib/agents', () => ({ listAgents: async () => ({ ok: true, value: [] }) }));
vi.mock('@/lib/run-session', () => ({ readRunSession: vi.fn() }));
vi.mock('@/lib/system', () => ({ listSpans: vi.fn() }));
vi.mock('@/lib/user-settings', () => ({ userSettings: vi.fn() }));
vi.mock('@/lib/pane-width', () => ({ paneWidth: async (spec: { default: number }) => spec.default }));
vi.mock('@/lib/page-title', () => ({ projectLabel: async (p: string) => p, clip: (t: string) => t }));
vi.mock('@/lib/issues', () => ({ getIssue: vi.fn() }));
vi.mock('@/components/task-details-toggle', () => ({
  TaskDetailsToggle: ({ shown }: { shown: boolean }) => <span>toggle:{String(shown)}</span>,
}));
vi.mock('@/components/issue-editor', () => ({
  IssueTitle: ({ title }: { title: string }) => <h1>{title}</h1>,
  IssueDescription: () => <p>description</p>,
  IssueBlockedByField: () => <span>blocked-by</span>,
  IssueCommentBox: () => <span>comment-box</span>,
  IssueArchivedBanner: () => <span>archived-banner</span>,
}));
vi.mock('@/components/task-summary', () => ({ TaskSummary: () => <span>summary</span> }));
vi.mock('next/navigation', async (load) => ({
  ...(await load<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const RUN = '11111111-2222-4333-8444-555555555555';
const issue = {
  number: 1,
  key: 'DE-1',
  title: 'Fix it',
  description: 'Fix it',
  status: 'in_progress' as const,
  stored_status: 'todo' as const,
  status_at: '2026-01-01T00:00:00.000Z',
  priority: 'none' as const,
  runs: [],
  blocked_by: [] as string[],
  comments: [],
  events: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function saved(details_pane?: boolean) {
  vi.mocked(userSettings).mockResolvedValue({
    ok: true,
    value: UserSettings.parse(details_pane === undefined ? {} : { tasks: { details_pane } }),
  });
}
async function html(panel?: string) {
  return renderToStaticMarkup(
    await TaskPage({
      params: Promise.resolve({ project: 'demo', id: 'DE-1' }),
      searchParams: Promise.resolve(panel ? { panel } : {}),
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getIssue).mockResolvedValue({ ok: true, value: { ...issue, runs: [RUN] } });
  vi.mocked(readRunSession).mockResolvedValue({ ok: true, value: { entries: [], live: false } } as never);
  vi.mocked(readDiff).mockResolvedValue({ ok: true, value: '' } as never);
  vi.mocked(listSpans).mockResolvedValue({ ok: true, value: { items: [] } } as never);
});

it('shows the sidebar by default, and when the settings cannot be read', async () => {
  saved();
  expect(await html()).toContain('aria-label="Panel"');
  vi.mocked(userSettings).mockResolvedValue({ ok: false, error: 'down' });
  const page = await html();
  expect(page).toContain('aria-label="Panel"');
  expect(page).toContain('toggle:true');
});

it('renders no sidebar and runs no pane-only query when it is hidden', async () => {
  saved(false);
  const page = await html();
  expect(page).toContain('toggle:false');
  expect(page).not.toContain('aria-label="Panel"');
  expect(page).not.toContain('Task details');
  expect(readRunSession).not.toHaveBeenCalled();
  expect(readDiff).not.toHaveBeenCalled();
  expect(listSpans).not.toHaveBeenCalled();
});

it('opens the sidebar for a ?panel= link while hidden, without touching the setting', async () => {
  saved(false);
  const page = await html('details');
  expect(page).toContain('aria-label="Panel"');
  expect(page).toContain('toggle:true');
  expect(page).toContain('Execution log');
});
