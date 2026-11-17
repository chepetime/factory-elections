import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend/client';
import { submitTask, reviseTask, approveTask, assignMember } from '@/app/actions';
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
  it('preserves option-looking prompt text as data and submits structured fields', async () => {
    rpc.mockResolvedValue({ text: id });
    const prompt = '--help "literal task"';
    await expect(submitTask({}, form({ project: 'demo', prompt }))).rejects.toThrow(
      `redirect:/projects/demo/tasks/${id}`,
    );
    expect(rpc).toHaveBeenCalledWith('SubmitTask', { project: 'demo', prompt });
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

it('keeps a created task when scheduling fails, instead of inviting a duplicate submission', async () => {
  rpc.mockResolvedValueOnce({ text: id });
  rpc.mockRejectedValueOnce(new Error('queue full'));
  await expect(submitTask({}, form({ project: 'demo', prompt: 'Do it', start: 'on' }))).rejects.toThrow(
    `redirect:/projects/demo/tasks/${id}?start=failed`,
  );
  expect(rpc.mock.calls.map(([method]) => method)).toEqual(['SubmitTask', 'StartRun']);
});

it('distinguishes unavailable execution from idle and preserves legacy background responses', async () => {
  rpc.mockRejectedValueOnce(new Error('offline'));
  expect((await backgroundRun('demo', id)).phase).toBe('unavailable');
  rpc.mockResolvedValueOnce({ json: JSON.stringify({ running: true, state: 'completed' }) });
  expect((await backgroundRun('demo', id)).phase).toBe('finalizing');
});
