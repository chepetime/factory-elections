'use client';
// App shell: icon rail on the page, a light-gray resizable task sidebar with a project picker and
// project options, and a raised main container. Layout inspired by Affect UI's "AI Chat / Double
// Sidebar" screen (https://www.affectui.com/screens/agent-chat-rail); original implementation, no
// Affect UI source or assets.
import { Menu } from '@base-ui/react/menu';
import {
  Blocks,
  Check,
  ChevronsUpDown,
  Copy,
  FolderGit2,
  Home,
  ListTodo,
  Users,
  Menu as MenuIcon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  User,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Stage } from '@factory/core';
import { cn } from '@/lib/utils';

interface ProjectSummary {
  name: string;
  repo: string;
}
interface TaskSummary {
  id: string;
  prompt: string;
  stage: Stage;
  created_at?: string;
}
type Load<T> = { kind: 'loading' } | { kind: 'failed' } | { kind: 'loaded'; value: T };

const LAST_PROJECT = 'factory.lastProject';
const SIDEBAR_WIDTH = 'factory.sidebarWidth';
const MIN_WIDTH = 220;
const MAX_WIDTH = 440;

const menuPopup =
  'z-50 w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none motion-safe:transition-opacity motion-safe:duration-100 data-starting-style:opacity-0 data-ending-style:opacity-0';
const menuItem =
  'flex min-h-9 pointer-coarse:min-h-11 cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50';
// The icon rail is dark in both themes; its items use light-on-dark tones of their own.
const railItem =
  'flex size-9 pointer-coarse:size-11 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-neutral-400';
const railActive = 'bg-white/10 text-orange-400 hover:text-orange-300';

const railButton =
  'flex size-9 pointer-coarse:size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

const NARROW = '(max-width: 899px)';

/** Whether the sidebar is a drawer (under 900px wide). */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(NARROW);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/** Remembers the project for the shell (localStorage) and for the server-rendered home (cookie). */
function remember(name: string) {
  localStorage.setItem(LAST_PROJECT, name);
  document.cookie = `${LAST_PROJECT}=${encodeURIComponent(name)}; path=/; max-age=31536000; samesite=lax`;
}

/** First non-empty line of the prompt. */
function taskTitle(prompt: string): string {
  return (
    prompt
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? prompt.trim()
  );
}

function repoName(repo: string): string {
  return repo.split('/').filter(Boolean).at(-1) ?? repo;
}

function ago(iso: string | undefined): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const STAGE_DOT: Record<Stage, string> = {
  queued: 'bg-muted-foreground/40',
  classified: 'bg-muted-foreground/40',
  blocked: 'bg-destructive',
  coding: 'bg-blue-500',
  'verification-failed': 'bg-destructive',
  reviewing: 'bg-blue-500',
  'awaiting-approval': 'bg-amber-500',
  approved: 'bg-emerald-500',
  rejected: 'bg-muted-foreground/40',
  'pr-opened': 'bg-emerald-500',
  failed: 'bg-destructive',
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

function useProjects(): Load<ProjectSummary[]> {
  const [state, setState] = useState<Load<ProjectSummary[]>>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    getJson<ProjectSummary[]>('/api/projects')
      .then((value) => live && setState({ kind: 'loaded', value }))
      .catch(() => live && setState({ kind: 'failed' }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function useTasks(project: string | undefined, pathname: string) {
  const [state, setState] = useState<Load<TaskSummary[]>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!project) return;
    let live = true;
    getJson<TaskSummary[]>(`/api/projects/${encodeURIComponent(project)}/tasks`)
      .then((tasks) => {
        const value = [...tasks].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
        if (live) setState({ kind: 'loaded', value });
      })
      .catch(() => live && setState({ kind: 'failed' }));
    return () => {
      live = false;
    };
    // Refetch on navigation so a new task shows up after it is created.
  }, [project, pathname, tick]);
  return { state, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

export function AppShell({ children }: { children: ReactNode }) {
  const params = useParams<{ project?: string; id?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const projects = useProjects();
  // Task chat screens own their columns and scrolling.
  const fullBleed = pathname === '/' || /^\/projects\/[^/]+\/(tasks\/[^/]+|team)$/.test(pathname);

  const [remembered, setRemembered] = useState<string | undefined>();
  useEffect(() => {
    const saved = localStorage.getItem(LAST_PROJECT) ?? undefined;
    setRemembered(saved);
    // Projects remembered before the cookie existed: hand it to the server-rendered home too.
    if (saved && !document.cookie.includes(`${LAST_PROJECT}=`)) {
      remember(saved);
      if (window.location.pathname === '/') router.refresh();
    }
  }, [router]);
  useEffect(() => {
    if (params.project) remember(params.project);
  }, [params.project]);

  const names = projects.kind === 'loaded' ? projects.value.map((p) => p.name) : [];
  const project = params.project ?? (remembered && names.includes(remembered) ? remembered : names[0]);
  const current = projects.kind === 'loaded' ? projects.value.find((p) => p.name === project) : undefined;
  const { state: tasks, refresh } = useTasks(project, pathname);

  const [drawer, setDrawer] = useState(false);
  const narrow = useNarrow();
  const drawerRef = useRef<HTMLDivElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  // Opening moves focus into the drawer; closing returns it to the menu button if it was inside.
  useEffect(() => {
    if (!narrow) return;
    const panel = drawerRef.current;
    if (drawer) panel?.querySelector<HTMLElement>('button:not([disabled]), a[href]')?.focus();
    else if (panel?.contains(document.activeElement)) openButton.current?.focus();
  }, [drawer, narrow]);
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  const [width, setWidth] = useState(272);
  useEffect(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH));
    if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved);
  }, []);

  const pick = (name: string) => {
    remember(name);
    setRemembered(name);
    router.push(
      /^\/projects\/[^/]+\/team/.test(pathname) ? `/projects/${name}/team` : `/projects/${name}/tasks/new`,
    );
  };

  return (
    <div className="relative flex h-dvh overflow-hidden bg-sidebar text-foreground">
      {drawer && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-30 bg-black/30 min-[900px]:hidden"
          onClick={() => setDrawer(false)}
        />
      )}
      <div
        ref={drawerRef}
        inert={narrow && !drawer}
        className={cn(
          'flex shrink-0 bg-sidebar max-[899px]:fixed max-[899px]:inset-y-0 max-[899px]:left-0 max-[899px]:z-40 max-[899px]:shadow-xl max-[899px]:transition-transform max-[899px]:duration-200 max-[899px]:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          !drawer && 'max-[899px]:-translate-x-full',
        )}
      >
        <Rail project={project} pathname={pathname} />
        <Sidebar
          width={width}
          setWidth={setWidth}
          projects={projects}
          project={project}
          current={current}
          tasks={tasks}
          activeId={params.id}
          onPick={pick}
          onRefresh={refresh}
          onClose={() => setDrawer(false)}
        />
      </div>

      <main className="flex min-w-0 flex-1 flex-col p-2 min-[900px]:pl-0">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-xs">
          <div className="flex items-center gap-2 border-b px-3 py-2 min-[900px]:hidden">
            <button
              type="button"
              aria-label="Open sidebar"
              ref={openButton}
              className={railButton}
              onClick={() => setDrawer(true)}
            >
              <MenuIcon className="size-4" />
            </button>
            <span className="truncate text-sm font-medium">{project ?? 'Software Factory'}</span>
          </div>
          {fullBleed ? (
            <div className="relative min-h-0 flex-1">{children}</div>
          ) : (
            <div className="relative min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-5xl px-6 py-6">{children}</div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Rail({ project, pathname }: { project: string | undefined; pathname: string }) {
  const tasksHref = project ? `/projects/${project}/tasks` : '/';
  const items = [
    { label: 'Home', href: '/', icon: Home, active: pathname === '/' },
    { label: 'Tasks', href: tasksHref, icon: ListTodo, active: /^\/projects\/[^/]+\/tasks/.test(pathname) },
    {
      label: 'Team',
      href: project ? `/projects/${project}/team` : '/',
      icon: Users,
      active: /^\/projects\/[^/]+\/team/.test(pathname),
    },
    { label: 'Components', href: '/components', icon: Blocks, active: pathname.startsWith('/components') },
  ];
  return (
    <nav aria-label="Main navigation" className="flex w-14 flex-col items-center gap-1 bg-neutral-950 py-3">
      <Menu.Root>
        <Menu.Trigger
          aria-label="Software Factory menu"
          className="mb-3 flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
        >
          SF
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="right" align="start" sideOffset={8} className="z-50">
            <Menu.Popup className={menuPopup}>
              <div className="px-2.5 py-1.5">
                <p className="text-sm font-medium">Software Factory</p>
                <p className="text-xs text-muted-foreground">Local · localhost</p>
              </div>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item className={menuItem} render={<Link href="/" />}>
                <Home className="size-4" /> Home
              </Menu.Item>
              <Menu.Item className={menuItem} render={<Link href="/components" />}>
                <Blocks className="size-4" /> Component library
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      {items.map(({ label, href, icon: Icon, active }) => (
        <Link
          key={label}
          href={href}
          aria-label={label}
          title={label}
          aria-current={active ? 'page' : undefined}
          className={cn(railItem, active && railActive)}
        >
          <Icon className="size-4" />
        </Link>
      ))}

      <Link
        href="/settings"
        aria-label="Settings"
        title="Settings"
        aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
        className={cn(railItem, 'mt-auto mb-2', pathname.startsWith('/settings') && railActive)}
      >
        <Settings className="size-4" />
      </Link>
      <div
        className="flex size-8 items-center justify-center rounded-full bg-white/12 text-neutral-300"
        title="Local user"
        aria-label="Local user"
        role="img"
      >
        <User className="size-4" />
      </div>
    </nav>
  );
}

function Sidebar({
  width,
  setWidth,
  projects,
  project,
  current,
  tasks,
  activeId,
  onPick,
  onRefresh,
  onClose,
}: {
  width: number;
  setWidth: (w: number) => void;
  projects: Load<ProjectSummary[]>;
  project: string | undefined;
  current: ProjectSummary | undefined;
  tasks: Load<TaskSummary[]>;
  activeId: string | undefined;
  onPick: (name: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);

  const clamp = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
  const persist = (w: number) => localStorage.setItem(SIDEBAR_WIDTH, String(w));
  const resize = (next: number) => {
    const w = clamp(next);
    setWidth(w);
    persist(w);
  };

  return (
    <aside
      aria-label="Tasks"
      style={{ width }}
      className="relative m-2 flex flex-col rounded-xl bg-muted/70 max-[899px]:m-0 max-[899px]:rounded-none max-[899px]:!w-72"
    >
      <div className="flex items-center gap-1 p-2">
        <Menu.Root>
          <Menu.Trigger
            disabled={projects.kind !== 'loaded' || projects.value.length === 0}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-foreground/5"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-semibold uppercase">
              {project?.[0] ?? '·'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {projects.kind === 'loading'
                  ? 'Loading projects'
                  : projects.kind === 'failed'
                    ? 'Projects unavailable'
                    : (project ?? 'No projects')}
              </span>
              {current && repoName(current.repo) !== current.name && (
                <span className="block truncate text-xs text-muted-foreground">{repoName(current.repo)}</span>
              )}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner align="start" sideOffset={6} className="z-50">
              <Menu.Popup className={menuPopup}>
                <div className="px-2.5 py-1.5 text-xs text-muted-foreground">Projects</div>
                {projects.kind === 'loaded' &&
                  projects.value.map((p) => (
                    <Menu.Item key={p.name} className={menuItem} onClick={() => onPick(p.name)}>
                      <FolderGit2 className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.repo}</span>
                      </span>
                      {p.name === project && <Check className="size-4" />}
                    </Menu.Item>
                  ))}
                <Menu.Separator className="my-1 h-px bg-border" />
                <div className="px-2.5 py-1.5 text-xs text-muted-foreground">
                  Add a project with <code>factory project add</code>
                </div>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        <Menu.Root>
          <Menu.Trigger
            aria-label="Project options"
            disabled={!current}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 data-popup-open:bg-foreground/5"
          >
            <MoreHorizontal className="size-4" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner align="end" sideOffset={6} className="z-50">
              <Menu.Popup className={menuPopup}>
                {current && (
                  <>
                    <Menu.Item
                      className={menuItem}
                      render={<Link href={`/projects/${current.name}/tasks/new`} />}
                    >
                      <Plus className="size-4" /> New task
                    </Menu.Item>
                    <Menu.Item className={menuItem} onClick={onRefresh}>
                      <RefreshCw className="size-4" /> Refresh tasks
                    </Menu.Item>
                    <Menu.Item
                      className={menuItem}
                      closeOnClick={false}
                      onClick={() => {
                        void navigator.clipboard?.writeText(current.repo).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        });
                      }}
                    >
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? 'Copied' : 'Copy repository path'}
                    </Menu.Item>
                    <Menu.Separator className="my-1 h-px bg-border" />
                    <div
                      className="truncate px-2.5 py-1.5 font-mono text-xs text-muted-foreground"
                      title={current.repo}
                    >
                      {current.repo}
                    </div>
                  </>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        <button
          type="button"
          aria-label="Close sidebar"
          className={cn(railButton, 'size-8 min-[900px]:hidden')}
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      {project && (
        <div className="px-2 pb-2">
          <Link
            href={`/projects/${project}/tasks/new`}
            aria-current={pathname.endsWith('/tasks/new') ? 'page' : undefined}
            className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Plus className="size-4" /> New task
          </Link>
        </div>
      )}

      <div className="px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">Tasks</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!project ? null : tasks.kind === 'loading' ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading tasks</p>
        ) : tasks.kind === 'failed' ? (
          <p className="px-2 py-1.5 text-sm text-destructive">Tasks unavailable</p>
        ) : tasks.value.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No tasks yet</p>
        ) : (
          <ul className="flex flex-col gap-px">
            {tasks.value.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/projects/${project}/tasks/${t.id}`}
                  aria-current={t.id === activeId ? 'page' : undefined}
                  title={`${taskTitle(t.prompt)} — ${t.stage}`}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2 py-1.5 pointer-coarse:py-3 text-sm transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring',
                    t.id === activeId && 'bg-background shadow-xs hover:bg-background',
                  )}
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', STAGE_DOT[t.stage])} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{taskTitle(t.prompt)}</span>
                  <span className="sr-only">, {t.stage}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {ago(t.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        className="absolute inset-y-2 -right-1.5 w-2 cursor-col-resize rounded-full outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring max-[899px]:hidden"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, w: width };
        }}
        onPointerMove={(e) => drag.current && setWidth(clamp(drag.current.w + e.clientX - drag.current.x))}
        onPointerUp={() => {
          if (drag.current) persist(width);
          drag.current = null;
        }}
        onDoubleClick={() => resize(272)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') resize(width - 16);
          if (e.key === 'ArrowRight') resize(width + 16);
        }}
      />
    </aside>
  );
}
