'use client';
// The homepage scene: an animated background on black, and one dark reflective metal card per
// project. The scene is black in both app themes. On load the cards rise in one after another while the
// background plays its own intro, and the add button follows the last card.
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react';
import { ReflectiveCard } from '@/components/backdrops/reflective-card';
import { HomeBackground } from '@/components/home-background';
import { LocalTime } from '@/components/local-time';
import type { ProjectStats } from '@/lib/workspace-home';
import { cn } from '@/lib/utils';

/** One project's card data, read on the server. */
export interface HomeCard {
  name: string;
  title: string;
  repo: string;
  icon: string;
  /** The project's accent color (`#rrggbb`). */
  accent: string;
  stats: ProjectStats;
  /** A profile problem worth a line on the card, e.g. "No repo profile". */
  note?: string;
  /** What could not be read for this project. */
  missing: string[];
}

/** The homepage frame: an animated background on black behind a scrolling body. */
export function HomeScene({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-full flex-col bg-black">
      <HomeBackground />
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {/* Centered in the window while it fits; it scrolls from the top when it does not. */}
        <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center px-6 py-8">{children}</div>
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

/** `color` moved toward white by `amount` (0 to 1), as `#rrggbb`. */
function lighten(color: string, amount: number): string {
  const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return `#${channels
    .map((c) =>
      Math.round(c + (255 - c) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Card height, in px. */
const CARD_HEIGHT = 360;
const muted = { color: 'var(--rc-muted)' } satisfies CSSProperties;

/** Intro timing, in seconds: the first card waits for the background to start, then one per step. */
const INTRO = { delay: 0.6, stagger: 0.09, duration: 0.7 } as const;
/** A strong ease-out: fast at the start, a long soft landing. */
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Every project as a reflective card that opens the project. */
export function ProjectCards({ cards }: { cards: HomeCard[] }) {
  const reduceMotion = useReducedMotion();
  const enter = (delay: number, from: { y: number; scale?: number }) =>
    reduceMotion
      ? { initial: false as const }
      : {
          initial: { opacity: 0, ...from },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: { delay, duration: INTRO.duration, ease: EASE_OUT },
        };
  // The button starts when the last card lands.
  const cardsDone = INTRO.delay + Math.max(0, cards.length - 1) * INTRO.stagger + INTRO.duration;
  return (
    <LazyMotion features={domAnimation}>
      <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card, index) => (
          <m.li
            key={card.name}
            className="min-w-0"
            {...enter(INTRO.delay + index * INTRO.stagger, { y: 28, scale: 0.96 })}
          >
            <Link
              href={`/projects/${encodeURIComponent(card.name)}`}
              className="block rounded-[24px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <ReflectiveCard
                theme="dark"
                width="100%"
                height={CARD_HEIGHT}
                glare={0.5}
                roughness={0.3}
                // A light tint of the accent, so the metal stays metal.
                tint={lighten(card.accent, 0.55)}
              >
                <CardContent card={card} />
              </ReflectiveCard>
            </Link>
          </m.li>
        ))}
      </ul>
      <m.div className="mt-6 self-start" {...enter(cardsDone, { y: 8 })}>
        <Link
          href="/projects"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
        >
          <Plus aria-hidden="true" className="size-4" /> Add project
        </Link>
      </m.div>
    </LazyMotion>
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
          className="flex size-12 shrink-0 items-center justify-center text-lg font-semibold uppercase"
          style={{
            background: `linear-gradient(180deg, color-mix(in srgb, ${card.accent} 55%, #3a3644) 0%, color-mix(in srgb, ${card.accent} 30%, #27242f) 100%)`,
            boxShadow: `var(--rc-tile-shadow), inset 0 0 0 1px color-mix(in srgb, ${card.accent} 60%, transparent)`,
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
