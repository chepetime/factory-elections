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
  it('sends an answer, a ticket command and a cancel in the shape the backend reads', async () => {
    rpc.mockResolvedValue({ json: '{}' });
    const answer = form('grill');
    answer.set('text', '  Voters, yes.  ');
    expect((await featureGateAction({}, answer)).message).toBeTruthy();
    expect(rpc).toHaveBeenLastCalledWith('FeatureAction', {
      project: 'demo',
      json: JSON.stringify({ id: 'feature-one', action: 'grill', text: 'Voters, yes.' }),
    });
    // The first grill turn has no answer: no empty text is sent.
    await featureGateAction({}, form('grill'));
    expect(rpc).toHaveBeenLastCalledWith('FeatureAction', {
      project: 'demo',
      json: JSON.stringify({ id: 'feature-one', action: 'grill' }),
    });
    const retry = form('retry-ticket');
    retry.set('ticket', 'T2');
    await featureGateAction({}, retry);
    expect(rpc).toHaveBeenLastCalledWith('FeatureAction', {
      project: 'demo',
      json: JSON.stringify({ id: 'feature-one', action: 'retry-ticket', ticket: 'T2' }),
    });
    expect(await featureGateAction({}, form('cancel'))).toEqual({ message: 'Cancelled.' });
  });
  it('renders an answer field and a ticket only for the commands that need them', () => {
    const answer = renderToStaticMarkup(
      <FeatureGate project="demo" id="feature-one" action="grill" label="Send answer" answer="Your answer" />,
    );
    expect(answer).toContain('name="text"');
    expect(answer).toContain('required');
    const retry = renderToStaticMarkup(
      <FeatureGate project="demo" id="feature-one" action="retry-ticket" ticket="T2" label="Run T2 again" />,
    );
    expect(retry).toContain('name="ticket"');
    expect(retry).toContain('value="T2"');
    expect(retry).not.toContain('name="text"');
  });
  it('rejects invalid actions and reports backend failures', async () => {
    expect((await featureGateAction({}, form('constructor'))).error).toBeTruthy();
    expect((await featureGateAction({}, form('delete'))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockRejectedValue(new Error('Board is busy'));
    expect(await featureGateAction({}, form('approve-board'))).toEqual({ error: 'Board is busy' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
