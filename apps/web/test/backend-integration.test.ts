import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend/client';
import { submitTask, reviseTask, approveTask, approveAndOpenPullRequest, assignMember } from '@/app/actions';
import { backgroundRun } from '@/lib/factory';
import { saveAssignment, teamMembers } from '@/lib/team';
import { systemStatus } from '@/lib/status';

vi.mock('@factory/backend/client', () => ({ backendCall: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock('@/lib/health', () => ({
  readEngineHealth: vi.fn(async () => ({
    status: 'ok',
    health: {
      task_store: 'available',
      integrations: [],
    },
  })),
}));
const rpc = vi.mocked(backendCall);
const id = '11111111-2222-4333-8444-555555555555';
function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
afterEach(() => vi.resetAllMocks());

describe('web/backend reintegration', () => {
  it('puts a started task in Todo for the agents, with option-looking text kept as data', async () => {
    const prompt = '--help "literal task"\nmore detail';
    rpc.mockResolvedValueOnce({
      json: JSON.stringify({
        number: 3,
        key: 'DE-3',
        title: '--help "literal task"',
        description: prompt,
        status: 'todo',
        stored_status: 'todo',
        status_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    });
    await expect(
      submitTask(
        {},
        form({
          project: 'demo',
          prompt: `Implement it.\n\n${prompt}`,
          title: '--help "literal task"',
          body: prompt,
          start: 'on',
        }),
      ),
    ).rejects.toThrow('redirect:/projects/demo/tasks/DE-3');
    expect(rpc).toHaveBeenCalledWith('CreateIssue', {
      project: 'demo',
      json: JSON.stringify({
        title: '--help "literal task"',
        description: prompt,
        status: 'todo',
      }),
    });
    expect(rpc).not.toHaveBeenCalledWith('SubmitTask', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('StartRun', expect.anything());
  });
  it('keeps a ticket or review preset as instructions under your text', async () => {
    rpc.mockResolvedValueOnce({
      json: JSON.stringify({
        number: 4,
        key: 'DE-4',
        title: 'Find slow pages',
        description: 'x',
        status: 'backlog',
        stored_status: 'backlog',
        status_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    });
    await expect(
      submitTask(
        {},
        form({
          project: 'demo',
          prompt: 'Create a ticket.\n\nFind slow pages',
          title: 'Find slow pages',
          body: 'Find slow pages',
          instructions: 'Create a ticket. Do not change code.',
        }),
      ),
    ).rejects.toThrow('redirect:/projects/demo/tasks/DE-4');
    expect(rpc).toHaveBeenCalledWith('CreateIssue', {
      project: 'demo',
      json: JSON.stringify({
        title: 'Find slow pages',
        description: 'Find slow pages\n\n**Instructions:** Create a ticket. Do not change code.',
        status: 'backlog',
      }),
    });
  });
  it('puts a task in Backlog when Start is off, and never starts a run', async () => {
    const prompt = '--help "literal task"\nmore detail';
    rpc.mockResolvedValueOnce({
      json: JSON.stringify({
        number: 3,
        key: 'DE-3',
        title: '--help "literal task"',
        description: prompt,
        status: 'todo',
        stored_status: 'todo',
        status_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    });
    await expect(submitTask({}, form({ project: 'demo', prompt, jira_key: 'VOTE-1' }))).rejects.toThrow(
      'redirect:/projects/demo/tasks/DE-3',
    );
    expect(rpc).toHaveBeenCalledWith('CreateIssue', {
      project: 'demo',
      json: JSON.stringify({
        title: '--help "literal task"',
        description: prompt,
        status: 'backlog',
        jira_key: 'VOTE-1',
      }),
    });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('sends revision and exact approval fields to the backend', async () => {
    rpc.mockResolvedValueOnce({ json: JSON.stringify({ id }) });
    expect(await reviseTask({}, form({ project: 'demo', id, note: 'Keep --this literal' }))).toEqual({
      message: 'Revision started.',
    });
    expect(rpc).toHaveBeenCalledWith('StartRun', {
      project: 'demo',
      id,
      action: 'revise',
      note: 'Keep --this literal',
    });
    rpc.mockResolvedValueOnce({ text: 'Approved' });
    await approveTask(
      {},
      form({ project: 'demo', id, head: 'abcdef1234', note: 'reviewed', acceptBlocking: 'on' }),
    );
    expect(rpc).toHaveBeenLastCalledWith(
      'ExecuteTask',
      { project: 'demo', id, action: 'approve', head: 'abcdef1234', note: 'reviewed', accept_blocking: true },
      120_000,
    );
  });
  it('approves then opens a draft pull request, and says so when only the approval worked', async () => {
    rpc
      .mockResolvedValueOnce({ text: 'Approved' })
      .mockResolvedValueOnce({ text: 'https://example.test/pr/1' });
    expect(await approveAndOpenPullRequest({}, form({ project: 'demo', id, head: 'abcdef1234' }))).toEqual({
      message: 'Opened https://example.test/pr/1',
    });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'ExecuteTask',
      { project: 'demo', id, action: 'approve', head: 'abcdef1234', note: '', accept_blocking: false },
      120_000,
    );
    expect(rpc).toHaveBeenLastCalledWith(
      'ExecuteTask',
      { project: 'demo', id, action: 'open-pr', draft: true },
      300_000,
    );
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ text: 'Approved' }).mockRejectedValueOnce(new Error('push refused'));
    expect(await approveAndOpenPullRequest({}, form({ project: 'demo', id, head: 'abcdef1234' }))).toEqual({
      error: 'Approved, but the pull request did not open: push refused',
    });
    rpc.mockReset();
    rpc.mockRejectedValueOnce(new Error('head moved'));
    expect(await approveAndOpenPullRequest({}, form({ project: 'demo', id, head: 'abcdef1234' }))).toEqual({
      error: 'head moved',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('awaits team persistence and reports backend failures', async () => {
    rpc.mockRejectedValueOnce(new Error('assignment failed'));
    expect(await assignMember('demo', 'test@example.com', 'Platform', ['backend'])).toEqual({
      error: 'assignment failed',
    });
    rpc.mockResolvedValueOnce({ text: 'Saved' });
    expect(await saveAssignment('demo', 'test@example.com', undefined, [])).toEqual({
      ok: true,
      value: null,
    });
    rpc.mockResolvedValueOnce({ json: '[]' });
    expect(await teamMembers('demo')).toEqual({ ok: true, value: [] });
  });
  it('renders validated diagnostic results without invoking a CLI', async () => {
    rpc.mockResolvedValue({
      json: JSON.stringify({
        checked_at: 'now',
        data_root: '/test',
        environment: [{ name: 'Node.js >= 26', ok: true, detail: 'v26' }],
        profiles: [{ name: 'demo', repo: '/repo', approved: false, error: 'not approved' }],
      }),
    });
    const status = await systemStatus();
    expect(status.checks).toContainEqual(
      expect.objectContaining({ group: 'Environment', status: 'ok', detail: 'v26' }),
    );
    expect(status.checks).toContainEqual(
      expect.objectContaining({ group: 'Projects', status: 'fail', detail: 'not approved' }),
    );
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('GetDiagnostics', {}, 30_000);
  });
});

it('distinguishes unavailable execution from idle and preserves legacy background responses', async () => {
  rpc.mockRejectedValueOnce(new Error('offline'));
  expect((await backgroundRun('demo', id)).phase).toBe('unavailable');
  rpc.mockResolvedValueOnce({ json: JSON.stringify({ running: true, state: 'completed' }) });
  expect((await backgroundRun('demo', id)).phase).toBe('finalizing');
});
