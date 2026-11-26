import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { backendCall } from '@factory/backend-client';
import { revalidatePath } from 'next/cache';
import { dismissInboxItem } from '@/app/actions';
import { Inbox } from '@/components/inbox';
import { getInbox } from '@/lib/inbox';

vi.mock('@factory/backend-client', () => ({ backendCall: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
const rpc = vi.mocked(backendCall);
const item = {
  id: 'gate:demo:123',
  project: 'demo',
  kind: 'gate',
  title: 'Review change',
  action: 'Approve the diff',
  since: '2026-01-01',
  task_id: '123',
};
function form(id = item.id, project = item.project) {
  const f = new FormData();
  f.set('id', id);
  f.set('project', project);
  return f;
}
afterEach(() => vi.clearAllMocks());

it('loads a unified inbox and renders project-specific links and dismiss controls', async () => {
  const feature = {
    ...item,
    id: 'board:other',
    project: 'other',
    kind: 'approve-board',
    feature_id: 'feature-one',
    task_id: undefined,
  };
  rpc.mockResolvedValue({ json: JSON.stringify({ items: [item, feature], dismissed: 2 }) });
  const result = await getInbox();
  expect(rpc).toHaveBeenCalledWith('GetInbox', {});
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('missing inbox');
  const html = renderToStaticMarkup(<Inbox items={result.value.items} />);
  expect(html).toContain('/projects/demo/tasks/123');
  expect(html).toContain('/projects/other/features/feature-one');
  expect(html).toContain('Approve the diff');
  expect(html).toContain('Dismiss Review change');
});

it('dismisses an item and refreshes the home layout', async () => {
  rpc.mockResolvedValue({ text: 'dismissed' });
  expect(await dismissInboxItem({}, form())).toEqual({ message: 'Dismissed.' });
  expect(rpc).toHaveBeenCalledWith('DismissInboxItem', {
    project: 'demo',
    json: JSON.stringify({ id: item.id }),
  });
  expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
});

it('handles empty inbox, invalid dismissal and backend failures', async () => {
  expect(renderToStaticMarkup(<Inbox items={[]} />)).toContain('Nothing is waiting on you');
  expect(renderToStaticMarkup(<Inbox error />)).toContain('Inbox unavailable');
  expect((await dismissInboxItem({}, form('', 'demo'))).error).toBeTruthy();
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockRejectedValue(new Error('offline'));
  expect(await getInbox()).toEqual({ ok: false });
  expect(await dismissInboxItem({}, form())).toEqual({ error: 'Could not dismiss this item. Try again.' });
  expect(revalidatePath).not.toHaveBeenCalled();
});
