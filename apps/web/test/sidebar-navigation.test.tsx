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

it('marks the logo as home, and the Tasks rail item on the board', () => {
  route.pathname = '/';
  expect(currentLinks(renderToStaticMarkup(<AppShell>Content</AppShell>))).toContain('/');
  route.pathname = '/board';
  const html = renderToStaticMarkup(<AppShell>Content</AppShell>);
  expect(html).toMatch(/aria-label="Tasks" title="Tasks" aria-current="page"/);
  expect(html).toContain('aria-label="Harbor Lighthouse home"');
});

it('groups the rail into Functions and System, and marks the page you are on', () => {
  route.pathname = '/tool-calls';
  const html = renderToStaticMarkup(<AppShell>Content</AppShell>);
  const group = (label: string) => {
    const start = html.indexOf(`role="group" aria-label="${label}"`);
    return [...html.slice(start, html.indexOf('</div>', start)).matchAll(/aria-label="([^"]+)" title=/g)].map(
      (m) => m[1],
    );
  };
  expect(group('Functions')).toEqual([
    'Dashboard',
    'Chat',
    'Tasks',
    'Findings',
    'Traffic',
    'Tool execution',
    'LLM recording',
    'Workspace',
  ]);
  expect(group('System')).toEqual(['LLM', 'Agent', 'MCP', 'Skill', 'Tools', 'Components']);
  expect(currentLinks(html)).toEqual(['/tool-calls']);
  // The providers page is the LLM item, not the user menu.
  route.pathname = '/user/providers';
  expect(currentLinks(renderToStaticMarkup(<AppShell>Content</AppShell>))).toContain('/user/providers');
  expect(renderToStaticMarkup(<AppShell>Content</AppShell>)).not.toMatch(
    /href="\/user" title="User settings" aria-label="User settings" aria-current/,
  );
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
