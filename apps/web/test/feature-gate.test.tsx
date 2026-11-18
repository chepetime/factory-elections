import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend/client';
import { revalidatePath } from 'next/cache';
import { featureGateAction } from '@/app/actions';
import { FeatureGate } from '@/components/feature-gate';

vi.mock('@factory/backend/client', () => ({ backendCall: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
const rpc = vi.mocked(backendCall);
function form(action: string, mirror = false) {
  const f = new FormData();
  f.set('project', 'demo');
  f.set('id', 'feature-one');
  f.set('action', action);
  if (mirror) f.set('mirror', 'on');
  return f;
}
afterEach(() => vi.clearAllMocks());

describe('feature approval gates', () => {
  it('renders the spec and board controls with the correct action and optional mirror choice', () => {
    const spec = renderToStaticMarkup(
      <FeatureGate project="demo" id="feature-one" action="approve-spec" label="Approve specification" />,
    );
    expect(spec).toContain('Approve specification');
    expect(spec).toContain('value="approve-spec"');
    expect(spec).not.toContain('name="mirror"');
    const board = renderToStaticMarkup(
      <FeatureGate project="demo" id="feature-one" action="approve-board" label="Approve board" />,
    );
    expect(board).toContain('Approve board');
    expect(board).toContain('name="mirror"');
    expect(board).toContain('value="approve-board"');
  });
  it('submits spec approval and refreshes the feature', async () => {
    rpc.mockResolvedValue({ json: '{}' });
    expect(await featureGateAction({}, form('approve-spec'))).toEqual({ message: 'Approved.' });
    expect(rpc).toHaveBeenCalledWith('FeatureAction', {
      project: 'demo',
      json: JSON.stringify({ id: 'feature-one', action: 'approve-spec' }),
    });
    expect(revalidatePath).toHaveBeenCalledWith('/projects/demo/features/feature-one');
  });
  it.each([false, true])('submits board approval with mirror=%s', async (mirror) => {
    rpc.mockResolvedValue({ json: '{}' });
    expect(await featureGateAction({}, form('approve-board', mirror))).toEqual({ message: 'Approved.' });
    expect(rpc).toHaveBeenCalledWith('FeatureAction', {
      project: 'demo',
      json: JSON.stringify({ id: 'feature-one', action: 'approve-board', mirror }),
    });
  });
  it('rejects invalid actions and reports backend failures', async () => {
    expect((await featureGateAction({}, form('delete'))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockRejectedValue(new Error('Board is busy'));
    expect(await featureGateAction({}, form('approve-board'))).toEqual({ error: 'Board is busy' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
