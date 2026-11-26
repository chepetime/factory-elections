'use client';
// The homepage scene: a dithered wave background behind the title bar, and one reflective metal card
// per project. Both follow the app theme (the `dark` class on <html>).
import Link from 'next/link';
import { FolderGit2, Plus } from 'lucide-react';
import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Dither } from '@/components/backdrops/dither';
import { ReflectiveCard } from '@/components/backdrops/reflective-card';
import { LocalTime } from '@/components/local-time';
import type { ProjectStats } from '@/lib/workspace-home';
import { cn } from '@/lib/utils';

/** One project's card data, read on the server. */
export interface HomeCard {
  name: string;
  title: string;
  repo: string;
  icon: string;
  stats: ProjectStats;
  /** A profile problem worth a line on the card, e.g. "No repo profile". */
  note?: string;
  /** What could not be read for this project. */
  missing: string[];
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** Whether the app shows its dark theme now; the server renders the light one. */
function useDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );
}

// Light mode uses an indexed palette: darker waves on a light background give the shader's
// two-color path almost no pattern, so the shades are given dark to light instead.
const SCENE = {
  light: { palette: ['#c9c9d1', '#dcdce2', '#ececef', '#f6f6f8'] },
  dark: { waveColor: '#bcbcbc', backgroundColor: '#120f17' },
} as const;

/** The homepage frame: the dithered background, a title bar with the add action, and a scrolling body. */
export function HomeScene({ count, children }: { count?: number; children: ReactNode }) {
  const dark = useDark();
  return (
    <div className="relative flex h-full flex-col">
      <div aria-hidden="true" className="absolute inset-0">
        <Dither
          key={dark ? 'dark' : 'light'}
          {...SCENE[dark ? 'dark' : 'light']}
          ditherMode="bayer"
          colorNum={4}
          pixelSize={2}
          waveSpeed={0.05}
          waveFrequency={3}
          waveAmplitude={0.3}
          mouseEffect="erase"
          mouseRadius={0.3}
        />
      </div>
      <header className="relative flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-sm">
        <FolderGit2 aria-hidden="true" className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Projects</h1>
        {count !== undefined && <span className="text-sm text-muted-foreground tabular-nums">{count}</span>}
        <Link
          href="/projects"
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-11"
        >
          <Plus aria-hidden="true" className="size-4" /> Add project
        </Link>
      </header>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </div>
    </div>
  );
}

/** A plain panel for text on the background, such as the empty and error states. */
export function HomePanel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border bg-background/90 p-6 shadow-sm backdrop-blur-sm', className)}>
      {children}
    </div>
  );
}

const ink = { color: 'var(--rc-ink)' } satisfies CSSProperties;
const muted = { color: 'var(--rc-muted)' } satisfies CSSProperties;

/** Every project as a reflective card that opens the project. */
export function ProjectCards({ cards }: { cards: HomeCard[] }) {
  const dark = useDark();
  return (
    <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <li key={card.name} className="min-w-0">
          <Link
            href={`/projects/${encodeURIComponent(card.name)}`}
            className="block rounded-[24px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <ReflectiveCard
              theme={dark ? 'dark' : 'light'}
              width="100%"
              height={260}
              glare={0.5}
              roughness={0.3}
            >
              <CardContent card={card} dark={dark} />
            </ReflectiveCard>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CardContent({ card, dark }: { card: HomeCard; dark: boolean }) {
  const { stats } = card;
  const warn = dark ? '#fdba74' : '#c2410c';
  const state =
    stats.needsYou > 0
      ? { label: `${stats.needsYou} need${stats.needsYou === 1 ? 's' : ''} you`, dot: '#f97316' }
      : stats.running > 0
        ? { label: `${stats.running} running`, dot: '#22c55e' }
        : { label: 'Idle', dot: dark ? '#71717a' : '#a1a1aa' };
  const numbers = [
    { label: 'Open tasks', value: stats.openTasks },
    { label: 'Running', value: stats.running },
    { label: 'Needs you', value: stats.needsYou, alert: stats.needsYou > 0 },
    { label: 'PRs', value: stats.pullRequests },
  ];
  return (
    <>
      <div className="flex items-center gap-3 text-[13px] leading-5">
        <span
          className="flex size-10 shrink-0 items-center justify-center text-base font-semibold uppercase"
          style={{
            background: 'var(--rc-tile)',
            boxShadow: 'var(--rc-tile-shadow), inset 0 0 0 1px var(--rc-tile-edge)',
            borderRadius: 'var(--rc-tile-radius)',
            ...ink,
          }}
        >
          {card.icon}
        </span>
        <span className="ml-auto inline-flex items-center gap-2" style={muted}>
          <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: state.dot }} />
          {state.label}
        </span>
      </div>

      <div className="mt-auto min-w-0">
        <h2 className="truncate text-2xl font-medium tracking-tight" style={ink}>
          {card.title}
        </h2>
        <p className="mt-1 truncate font-mono text-xs" style={muted} title={card.repo}>
          {card.repo}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs" style={muted}>
          {stats.lastActivity ? (
            <span>
              Updated <LocalTime iso={stats.lastActivity} format="date-time" />
            </span>
          ) : (
            <span>No activity yet</span>
          )}
          <span>${stats.spendThisMonth.toFixed(2)} this month</span>
          {card.note && <span style={{ color: warn }}>{card.note}</span>}
          {card.missing.length > 0 && (
            <span style={{ color: warn }}>Could not read {card.missing.join(', ')}</span>
          )}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-4 gap-2">
        {numbers.map(({ label, value, alert }) => (
          <div key={label} className="min-w-0">
            <dt className="truncate text-[11px]" style={muted}>
              {label}
            </dt>
            <dd className="text-base font-semibold tabular-nums" style={alert ? { color: warn } : ink}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
