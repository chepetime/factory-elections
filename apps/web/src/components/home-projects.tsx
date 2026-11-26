'use client';
// The homepage scene: dithered waves on black, and one dark reflective metal card per project. The
// scene is black in both app themes.
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
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

/** The homepage frame: dithered waves on black behind a scrolling body. */
export function HomeScene({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-full flex-col bg-black">
      <div aria-hidden="true" className="absolute inset-0">
        <Dither
          waveColor="#bcbcbc"
          backgroundColor="#000000"
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
  return (
    <>
      <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <li key={card.name} className="min-w-0">
            <Link
              href={`/projects/${encodeURIComponent(card.name)}`}
              className="block rounded-[24px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <ReflectiveCard theme="dark" width="100%" height={260} glare={0.5} roughness={0.3}>
                <CardContent card={card} />
              </ReflectiveCard>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/projects"
        className="mt-6 inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
      >
        <Plus aria-hidden="true" className="size-4" /> Add project
      </Link>
    </>
  );
}

function CardContent({ card }: { card: HomeCard }) {
  const { stats } = card;
  const warn = '#fdba74';
  const state =
    stats.needsYou > 0
      ? { label: `${stats.needsYou} need${stats.needsYou === 1 ? 's' : ''} you`, dot: '#f97316' }
      : stats.running > 0
        ? { label: `${stats.running} running`, dot: '#22c55e' }
        : { label: 'Idle', dot: '#71717a' };
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
