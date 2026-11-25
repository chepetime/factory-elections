import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from '@/components/app-shell';
import { SidebarWork } from '@/components/sidebar-work';

const route = vi.hoisted(() => ({ pathname: '/projects/demo/tasks' }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useParams: () => ({ project: 'demo', id: route.pathname.split('/')[4] }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function currentLinks(html: string) {
  return [...html.matchAll(/<a\b([^>]+)>/g)]
    .filter(([, attributes]) => attributes!.includes('aria-current="page"'))
    .map(([, attributes]) => attributes!.match(/href="([^"]+)"/)![1]);
}

it.each([
  ['tasks', ['/projects/demo/tasks', '/projects/demo/tasks']],
  ['tasks/FE-1', []],
  ['tasks/new', ['/projects/demo/tasks/new']],
  ['tasks/archived', ['/projects/demo/tasks/archived']],
  ['team', ['/projects/demo/team']],
  ['team-extra', []],
])('selects the intended navigation destination on %s', (path, expected) => {
  route.pathname = `/projects/demo/${path}`;
  expect(currentLinks(renderToStaticMarkup(<AppShell>Content</AppShell>))).toEqual(expected);
});

it('allows the current task and its agent entry to both be selected', () => {
  const html = renderToStaticMarkup(
    <SidebarWork
      project="demo"
      activeKey="FE-1"
      issues={[
        {
          key: 'FE-1',
          title: 'Fix navigation',
          status: 'todo',
          archived: false,
          updated_at: new Date().toISOString(),
          run: { stage: 'queued' },
        },
        {
          key: 'FE-2',
          title: 'Another task',
          status: 'todo',
          archived: false,
          updated_at: new Date().toISOString(),
        },
      ]}
    />,
  );
  expect(currentLinks(html)).toEqual(['/projects/demo/tasks/FE-1', '/projects/demo/tasks/FE-1']);
});

it.each([
  ['/', ['/']],
  ['/board', ['/board']],
])('marks the logo as home and the Board rail item on %s', (pathname, expected) => {
  route.pathname = pathname;
  const html = renderToStaticMarkup(<AppShell>Content</AppShell>);
  expect(currentLinks(html).filter((href) => href === '/' || href === '/board')).toEqual(expected);
  expect(html).toContain('aria-label="Software Factory home"');
});
