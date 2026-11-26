'use client';
// App shell: icon rail on the page, a light-gray resizable task sidebar with a project picker and
// project options, and a raised main container. Layout inspired by Affect UI's "AI Chat / Double
// Sidebar" screen (https://www.affectui.com/screens/agent-chat-rail); original implementation, no
// Affect UI source or assets.
import { Menu } from '@base-ui/react/menu';
import {
  Activity,
  Archive,
  Blocks,
  Bot,
  Bug,
  Cpu,
  FolderOpen,
  LayoutDashboard,
  Plug,
  Radio,
  Sparkles,
  SquareTerminal,
  Wrench,
  Check,
  ChevronsUpDown,
  Copy,
  FolderGit2,
  GitPullRequest,
  Home,
  KanbanSquare,
  ChevronRight,
  Network,
  MessageSquare,
  Users,
  Menu as MenuIcon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Tickets,
  User,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { HarborMark } from '@/components/harbor-mark';
import { SidebarWork, type IssueSummary } from '@/components/sidebar-work';
import { SidebarLink } from '@/components/sidebar-link';
import { UserSidebar } from '@/components/user-sidebar';
import { cn } from '@/lib/utils';

interface ProjectSummary {
  name: string;
  repo: string;
  display_name?: string;
  icon?: string;
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
const railActive = 'bg-orange-400/15 text-orange-300 ring-1 ring-orange-400 ring-inset hover:text-orange-200';

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

function repoName(repo: string): string {
  return repo.split('/').filter(Boolean).at(-1) ?? repo;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

function useProjects(pathname: string): Load<ProjectSummary[]> {
  const [state, setState] = useState<Load<ProjectSummary[]>>({ kind: 'loading' });
  // Refetch on navigation so a newly added project shows up.
  useEffect(() => {
    let live = true;
    getJson<ProjectSummary[]>('/api/projects')
      .then((value) => live && setState({ kind: 'loaded', value }))
      .catch(() => live && setState({ kind: 'failed' }));
    return () => {
      live = false;
    };
  }, [pathname]);
  return state;
}

function useIssues(project: string | undefined, pathname: string) {
  const [state, setState] = useState<Load<IssueSummary[]>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!project) return;
    let live = true;
    getJson<IssueSummary[]>(`/api/projects/${encodeURIComponent(project)}/issues`)
      .then((value) => live && setState({ kind: 'loaded', value }))
      .catch(() => live && setState({ kind: 'failed' }));
    return () => {
      live = false;
    };
    // Refetch on navigation, so a new task shows up after it is created.
  }, [project, pathname, tick]);
  // Agents change state on their own; poll while the tab is visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    }, 10_000);
    return () => clearInterval(timer);
  }, []);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { state, refresh };
}

export function AppShell({ children }: { children: ReactNode }) {
  const params = useParams<{ project?: string; id?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const projects = useProjects(pathname);
  // Task chat screens own their columns and scrolling.
  // The homepage spans every project, so it has no sidebar; user settings have their own.
  const home = pathname === '/';
  const user = pathname === '/user' || pathname.startsWith('/user/');
  // Workspace settings span every project too.
  const global = home || pathname === '/settings' || pathname.startsWith('/settings/');
  const fullBleed =
    home ||
    pathname === '/board' ||
    /^\/projects\/[^/]+$/.test(pathname) ||
    /^\/projects\/[^/]+\/(tasks|tasks\/[^/]+|team|reviews\/\d+)$/.test(pathname) ||
    /^\/chat(\/[^/]+)?$/.test(pathname);

  const [remembered, setRemembered] = useState<string | undefined>();
  useEffect(() => {
    const saved = localStorage.getItem(LAST_PROJECT) ?? undefined;
    setRemembered(saved);
    // Projects remembered before the cookie existed: hand it to the server-rendered home too.
    if (saved && !document.cookie.includes(`${LAST_PROJECT}=`)) {
      remember(saved);
      if (window.location.pathname === '/board') router.refresh();
    }
  }, [router]);
  useEffect(() => {
    if (params.project) remember(params.project);
  }, [params.project]);

  const names = projects.kind === 'loaded' ? projects.value.map((p) => p.name) : [];
  const project = params.project ?? (remembered && names.includes(remembered) ? remembered : names[0]);
  const current = projects.kind === 'loaded' ? projects.value.find((p) => p.name === project) : undefined;
  const { state: tasks, refresh } = useIssues(project, pathname);

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
    router.push(/^\/projects\/[^/]+\/team/.test(pathname) ? `/projects/${name}/team` : `/projects/${name}`);
  };

  return (
    <div className="relative flex h-dvh overflow-hidden bg-neutral-950 text-foreground">
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
          'flex shrink-0 bg-neutral-950 max-[899px]:fixed max-[899px]:inset-y-0 max-[899px]:left-0 max-[899px]:z-40 max-[899px]:shadow-xl max-[899px]:transition-transform max-[899px]:duration-200 max-[899px]:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          !drawer && 'max-[899px]:-translate-x-full',
        )}
      >
        <Rail pathname={pathname} />
        {!global && (
          // The sidebar and the main container form one light panel on the black frame.
          <div className="flex bg-sidebar min-[900px]:my-2 min-[900px]:rounded-l-xl">
            {user ? (
              <UserSidebar width={width} onClose={() => setDrawer(false)} />
            ) : (
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
            )}
          </div>
        )}
      </div>

      <main
        // Same panel on every page, so the container keeps its place; only the sidebar comes and goes.
        className={cn(
          'flex min-w-0 flex-1 flex-col min-[900px]:my-2 min-[900px]:mr-2',
          // The homepage draws its own background, so it has no panel or raised container.
          home ? 'overflow-hidden min-[900px]:rounded-xl' : 'bg-sidebar p-2',
          !home && (global ? 'min-[900px]:rounded-xl' : 'min-[900px]:rounded-r-xl min-[900px]:pl-0'),
        )}
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            !home && 'rounded-xl border bg-background shadow-xs',
          )}
        >
          <div className="flex items-center gap-2 border-b bg-background px-3 py-2 min-[900px]:hidden">
            <button
              type="button"
              aria-label="Open sidebar"
              ref={openButton}
              className={railButton}
              onClick={() => setDrawer(true)}
            >
              <MenuIcon className="size-4" />
            </button>
            <span className="truncate text-sm font-medium">
              {global ? 'Harbor Lighthouse' : user ? 'User settings' : (project ?? 'Harbor Lighthouse')}
            </span>
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

/** The rail's two groups: the work the factory does, then what it is built from. */
/** The rail: the whole installation, not one project. */
function railItems(pathname: string) {
  return [
    { label: 'Home', href: '/', icon: Home, active: pathname === '/' },
    { label: 'Network', href: '/network', icon: Network, active: pathname === '/network' },
  ];
}

/**
 * Pages that left the rail. They wait in the project sidebar, switched off, until each is made to
 * work per project; their routes still open by URL.
 */
const PARKED = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Chat', icon: MessageSquare },
  { label: 'Findings', icon: Bug },
  { label: 'Traffic', icon: Activity },
  { label: 'Tool execution', icon: SquareTerminal },
  { label: 'LLM recording', icon: Radio },
  { label: 'Workspace', icon: FolderOpen },
  { label: 'LLM', icon: Cpu },
  { label: 'Agent', icon: Bot },
  { label: 'MCP', icon: Plug },
  { label: 'Skill', icon: Sparkles },
  { label: 'Tools', icon: Wrench },
  { label: 'Components', icon: Blocks },
] as const;

/** The parked pages, folded under one toggle so the task list keeps its room. */
function ParkedPages() {
  return (
    <details className="group/parked">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground select-none hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 transition-transform group-open/parked:rotate-90 motion-reduce:transition-none"
        />
        More pages
        <span className="ml-auto text-xs">Off</span>
      </summary>
      <ul
        aria-label="More pages, not available yet"
        // Capped, so opening it does not push the task list and footer out of the sidebar.
        className="mt-px flex max-h-52 flex-col gap-px overflow-y-auto"
      >
        {PARKED.map(({ label, icon: Icon }) => (
          <li
            key={label}
            aria-disabled="true"
            title="Not available yet"
            className="flex min-w-0 cursor-not-allowed items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground pointer-coarse:min-h-11"
          >
            <Icon className="size-4 opacity-60" aria-hidden /> {label}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Rail({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Main navigation"
      className="flex w-14 flex-col items-center gap-1 overflow-y-auto bg-neutral-950 py-3 [scrollbar-width:none]"
    >
      <Link
        href="/"
        aria-label="Harbor Lighthouse home"
        title="Home"
        aria-current={pathname === '/' ? 'page' : undefined}
        className="mb-3 shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
      >
        <HarborMark className="ring-1 ring-white/15 rounded-lg" />
      </Link>

      <div role="group" aria-label="Installation" className="flex flex-col items-center gap-1">
        {railItems(pathname).map(({ label, href, icon: Icon, active }) => (
          <Link
            key={label}
            href={href}
            aria-label={label}
            title={label}
            aria-current={active ? 'page' : undefined}
            className={cn(railItem, 'shrink-0', active && railActive)}
          >
            <Icon className="size-4" />
          </Link>
        ))}
      </div>

      <Link
        href="/settings"
        aria-label="Settings"
        title="Settings"
        aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
        className={cn(railItem, 'mt-auto mb-2 shrink-0', pathname.startsWith('/settings') && railActive)}
      >
        <Settings className="size-4" />
      </Link>
      <Link
        href="/user"
        title="User settings"
        aria-label="User settings"
        aria-current={
          pathname.startsWith('/user') && !pathname.startsWith('/user/providers') ? 'page' : undefined
        }
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-neutral-300 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 pointer-coarse:size-11',
          pathname.startsWith('/user') &&
            !pathname.startsWith('/user/providers') &&
            'ring-1 ring-orange-400 text-orange-300',
        )}
      >
        <User aria-hidden="true" className="size-4" />
      </Link>
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
  tasks: Load<IssueSummary[]>;
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
            disabled={projects.kind !== 'loaded'}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-foreground/5"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-semibold uppercase">
              {current?.icon || project?.[0] || '·'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {projects.kind === 'loading'
                  ? 'Loading projects'
                  : projects.kind === 'failed'
                    ? 'Projects unavailable'
                    : current?.display_name || project || 'No projects'}
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
                        <span className="block truncate">
                          {p.icon ? `${p.icon} ` : ''}
                          {p.display_name || p.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{p.repo}</span>
                      </span>
                      {p.name === project && <Check className="size-4" />}
                    </Menu.Item>
                  ))}
                <Menu.Separator className="my-1 h-px bg-border" />
                <Menu.Item className={menuItem} render={<Link href="/projects" />}>
                  <Plus className="size-4" /> Add project
                </Menu.Item>
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
                    <Menu.Item
                      className={menuItem}
                      render={<Link href={`/projects/${current.name}/settings`} />}
                    >
                      <SlidersHorizontal className="size-4" /> Project settings
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
        <div className="flex flex-col gap-1 px-2 pb-2">
          <SidebarLink href={`/projects/${project}`} current={pathname === `/projects/${project}`}>
            <Home className="size-4 text-muted-foreground" /> Home
          </SidebarLink>
          <SidebarLink
            href={`/projects/${project}/tasks`}
            current={pathname === `/projects/${project}/tasks`}
          >
            <KanbanSquare className="size-4 text-muted-foreground" /> Tasks
          </SidebarLink>
          <SidebarLink
            href={`/projects/${project}/team`}
            current={/^\/projects\/[^/]+\/team(?:\/|$)/.test(pathname)}
          >
            <Users className="size-4 text-muted-foreground" /> Team members
          </SidebarLink>
          <SidebarLink
            href={`/projects/${project}/reviews`}
            current={/^\/projects\/[^/]+\/reviews(?:\/|$)/.test(pathname)}
          >
            <GitPullRequest className="size-4 text-muted-foreground" /> PR reviews
          </SidebarLink>
          <SidebarLink
            href={`/projects/${project}/tickets`}
            current={/^\/projects\/[^/]+\/tickets(?:\/|$)/.test(pathname)}
          >
            <Tickets className="size-4 text-muted-foreground" /> Tickets
          </SidebarLink>
          <SidebarLink
            href={`/projects/${project}/features`}
            current={/^\/projects\/[^/]+\/features(?:\/|$)/.test(pathname)}
          >
            <Tickets className="size-4 text-muted-foreground" /> Features
          </SidebarLink>
          <SidebarLink
            href={`/projects/${project}/weekly`}
            current={/^\/projects\/[^/]+\/weekly(?:\/|$)/.test(pathname)}
          >
            <span aria-hidden="true">◷</span> Weekly
          </SidebarLink>
          <ParkedPages />
          <div role="separator" className="my-2 h-px bg-border" />
          <Link
            href={`/projects/${project}/tasks/new`}
            aria-current={pathname.endsWith('/tasks/new') ? 'page' : undefined}
            className="flex w-full items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Plus className="size-4" /> New task
          </Link>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!project ? null : tasks.kind === 'loading' ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading tasks</p>
        ) : tasks.kind === 'failed' ? (
          <p className="px-2 py-1.5 text-sm text-destructive">Tasks unavailable. Refresh to try again.</p>
        ) : (
          <SidebarWork project={project} issues={tasks.value} activeKey={activeId} onChanged={onRefresh} />
        )}
      </div>

      {project && (
        <div className="flex flex-col gap-px border-t px-2 py-2">
          <SidebarLink
            href={`/projects/${project}/tasks/archived`}
            current={pathname === `/projects/${project}/tasks/archived`}
          >
            <Archive className="size-4 text-muted-foreground" /> Archived
            {tasks.kind === 'loaded' && tasks.value.some((i) => i.archived) && (
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {tasks.value.filter((i) => i.archived).length}
              </span>
            )}
          </SidebarLink>
          <SidebarLink
            href={`/projects/${project}/settings`}
            current={/^\/projects\/[^/]+\/settings(?:\/|$)/.test(pathname)}
          >
            <SlidersHorizontal className="size-4 text-muted-foreground" /> Project settings
          </SidebarLink>
        </div>
      )}

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
