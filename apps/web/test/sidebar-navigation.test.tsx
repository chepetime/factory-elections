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
  ['tasks', ['/projects/demo/tasks']],
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

it('the rail holds the logo, Home and Network, and marks the page you are on', () => {
  route.pathname = '/';
  const home = renderToStaticMarkup(<AppShell>Content</AppShell>);
  expect(home).toContain('aria-label="Harbor Lighthouse home"');
  // The logo and the Home item both open the homepage.
  expect(currentLinks(home)).toEqual(['/', '/']);
  const start = home.indexOf('role="group" aria-label="Installation"');
  const items = [
    ...home.slice(start, home.indexOf('</div>', start)).matchAll(/aria-label="([^"]+)" title=/g),
  ];
  expect(items.map((m) => m[1])).toEqual(['Home', 'Network']);
  route.pathname = '/network';
  expect(currentLinks(renderToStaticMarkup(<AppShell>Content</AppShell>))).toEqual(['/network']);
});

it('parks the old rail pages in the project sidebar, switched off', () => {
  route.pathname = '/projects/demo/tasks';
  const html = renderToStaticMarkup(<AppShell>Content</AppShell>);
  const start = html.indexOf('aria-label="More pages, not available yet"');
  const parked = html.slice(start, html.indexOf('</ul>', start));
  expect([...parked.matchAll(/<li[^>]*aria-disabled="true"/g)]).toHaveLength(7);
  expect(parked).toContain('Tool execution');
  expect(parked).not.toContain('Chat');
  // Parked pages are not links, and they no longer sit on the rail.
  expect(parked).not.toContain('<a ');
  expect(html).not.toContain('href="/tool-calls"');
});

it('shows the project sidebar everywhere but the homepage, and user settings have their own', () => {
  route.pathname = '/user/preferences';
  const user = renderToStaticMarkup(<AppShell>Content</AppShell>);
  expect(user).toContain('aria-label="User settings"');
  expect(user).not.toContain('aria-label="Tasks"><');
  expect(currentLinks(user)).toContain('/user/preferences');
  route.pathname = '/settings';
  expect(renderToStaticMarkup(<AppShell>Content</AppShell>)).not.toContain('<aside');
  route.pathname = '/';
  expect(renderToStaticMarkup(<AppShell>Content</AppShell>)).not.toContain('<aside');
  route.pathname = '/board';
  expect(renderToStaticMarkup(<AppShell>Content</AppShell>)).toContain('<aside');
});

it.each([
  ['chat', '/projects/demo/chat'],
  ['chat/0b0c1f6e-1f1c-4c39-9a3e-2d7c9c1f0a11', '/projects/demo/chat'],
  ['llms', '/projects/demo/llms'],
  ['agents/ada', '/projects/demo/agents'],
  ['mcp', '/projects/demo/mcp'],
  ['skills', '/projects/demo/skills'],
  ['tools', '/projects/demo/tools'],
])('the project sidebar links its agent pages and marks %s', (path, expected) => {
  route.pathname = `/projects/demo/${path}`;
  const html = renderToStaticMarkup(<AppShell>Content</AppShell>);
  for (const page of ['chat', 'llms', 'agents', 'mcp', 'skills', 'tools'])
    expect(html).toContain(`href="/projects/demo/${page}"`);
  expect(currentLinks(html)).toEqual([expected]);
});
