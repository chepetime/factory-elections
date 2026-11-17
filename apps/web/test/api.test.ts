// Route handlers validate backend snapshots; transport behavior is exercised by backend smoke tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend/client';
import { GET as getProjects } from '@/app/api/projects/route';
import { GET as getTasks } from '@/app/api/projects/[project]/tasks/route';

vi.mock('@factory/backend/client', () => ({ backendCall: vi.fn() }));
const rpc = vi.mocked(backendCall);
const task = {
  id: '11111111-2222-4333-8444-555555555555',
  project: 'demo',
  repo: '/r',
  prompt: 'Do it',
  stage: 'queued',
};
const params = (project: string) => ({ params: Promise.resolve({ project }) });
afterEach(() => vi.resetAllMocks());

describe('project and task read APIs', () => {
  it('returns validated project snapshots over the backend bridge', async () => {
    rpc.mockResolvedValue({ json: JSON.stringify([{ name: 'demo', repo: '/r' }]) });
    const res = await getProjects();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ name: 'demo', repo: '/r' }]);
    expect(rpc).toHaveBeenCalledWith('ListProjects', { project: '' });
  });
  it.each(['unavailable', 'invalid JSON', 'invalid records'])(
    'reports unavailable for %s without leaking details',
    async (kind) => {
      if (kind === 'unavailable') rpc.mockRejectedValue(new Error('secret /Users/x path'));
      else
        rpc.mockResolvedValue({
          json: kind === 'invalid JSON' ? 'nope' : JSON.stringify([{ name: 'bad name!' }]),
        });
      const res = await getProjects();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'project_source_unavailable' });
    },
  );
  it('returns validated tasks and rejects invalid project names before calling the backend', async () => {
    rpc.mockResolvedValue({ json: JSON.stringify([task]) });
    const ok = await getTasks(new Request('http://127.0.0.1/'), params('demo'));
    expect(ok.status).toBe(200);
    expect((await ok.json())[0].id).toBe(task.id);
    rpc.mockClear();
    const bad = await getTasks(new Request('http://127.0.0.1/'), params('bad name'));
    expect(bad.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('reports task source unavailable on backend failure', async () => {
    rpc.mockRejectedValue(new Error('backend down'));
    const res = await getTasks(new Request('http://127.0.0.1/'), params('demo'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'task_source_unavailable' });
  });
});
