'use client';
// A small grid of dots that a wave runs through while work goes on, then freezes into a check or a
// cross while its stopwatch stops. Ported to TypeScript from React Bits' LatticeLoader
// (https://reactbits.dev, MIT + Commons Clause). Addition: `startedAt` starts the stopwatch at a
// known time, for work that began before the page opened.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@factory/ui/lib/utils';
import styles from './lattice-loader.module.css';

type Grid = 3 | 4;
type Status = 'working' | 'done' | 'error';
interface Pattern {
  /** One delay per cell in step units; null is a hole. */
  cells: (number | null)[];
  loop: number;
  scale: number;
  /** The share of the cycle a cell stays bright: 0.25, 0.35, 0.45 or 0.62. */
  lit?: number;
}

const PATTERNS: Record<string, Partial<Record<Grid, Pattern>>> = {
  arrow: { 3: { cells: [1, 2, 3, 0, 1, 2, 1, 2, 3], loop: 7.2, scale: 1 } },
  dots: { 3: { cells: [0, 1, 2, 0, 1, 2, 0, 1, 2], loop: 3, scale: 2.4 } },
  ripple: { 3: { cells: [2, 1, 2, 1, 0, 1, 2, 1, 2], loop: 4.8, scale: 1.5 } },
  spiral: { 3: { cells: [0, 1, 2, 7, 8, 3, 6, 5, 4], loop: 9, scale: 1.2, lit: 0.35 } },
  orbit: {
    3: { cells: [0, 1, 2, 7, null, 3, 6, 5, 4], loop: 8, scale: 1.2 },
    4: {
      cells: [0, 1, 2, 3, 11, null, null, 4, 10, null, null, 5, 9, 8, 7, 6],
      loop: 6,
      scale: 1.2,
      lit: 0.45,
    },
  },
  snake: {
    3: { cells: [0, 1, 2, 5, 4, 3, 6, 7, 8], loop: 9, scale: 1, lit: 0.35 },
    4: { cells: [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12], loop: 16, scale: 1, lit: 0.25 },
  },
  sweep: { 4: { cells: [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6], loop: 5, scale: 1, lit: 0.45 } },
  spin: { 4: { cells: [0, 0, 1, 1, 0, 0, 1, 1, 3, 3, 2, 2, 3, 3, 2, 2], loop: 4, scale: 1.6, lit: 0.35 } },
  rain: { 4: { cells: [0, 2, 1, 3, 1, 3, 2, 4, 2, 4, 3, 5, 3, 5, 4, 6], loop: 4, scale: 1.2, lit: 0.35 } },
  pulse: { 4: { cells: [2, 1, 1, 2, 1, 0, 0, 1, 1, 0, 0, 1, 2, 1, 1, 2], loop: 2.4, scale: 2.5, lit: 0.45 } },
};
const DEFAULT_PATTERN: Record<Grid, string> = { 3: 'orbit', 4: 'sweep' };
const MARKS: Record<Grid, { done: number[]; error: number[] }> = {
  3: { done: [2, 3, 5, 7], error: [0, 2, 4, 6, 8] },
  4: { done: [7, 8, 10, 13], error: [0, 3, 5, 6, 9, 10, 12, 15] },
};

const resolvePattern = (pattern: string, grid: Grid): Pattern =>
  PATTERNS[pattern]?.[grid] ?? PATTERNS[DEFAULT_PATTERN[grid]]![grid]!;
/** Tenths of a second as "4.2s" or "1m 3.0s". */
const fmt = (ds: number) =>
  ds < 600 ? `${(ds / 10).toFixed(1)}s` : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`;
const spoken = (ds: number) =>
  ds < 600
    ? `${(ds / 10).toFixed(1)} seconds`
    : `${Math.floor(ds / 600)} minutes ${((ds % 600) / 10).toFixed(1)} seconds`;

export interface LatticeLoaderProps {
  /** The verb while working. */
  label?: string;
  /** The verb after it is done; the frozen time follows it. */
  doneLabel?: string;
  /** The verb after it failed. */
  errorLabel?: string;
  status?: Status;
  /** At 3 × 3: arrow, dots, orbit, ripple, snake, spiral. At 4 × 4: sweep, spin, rain, pulse, orbit, snake. */
  pattern?: string;
  grid?: Grid;
  shape?: 'square' | 'round';
  color?: string;
  doneColor?: string;
  errorColor?: string;
  cellSize?: number;
  gap?: number;
  fontSize?: number;
  /** Ms between neighbouring cells lighting. */
  step?: number;
  idleOpacity?: number;
  glow?: boolean;
  glowColor?: string;
  showTimer?: boolean;
  /** Epoch ms the work started, so the stopwatch includes time before the page opened. */
  startedAt?: number;
  className?: string;
  style?: CSSProperties;
}

export function LatticeLoader({
  label = 'Working',
  doneLabel = 'Done in',
  errorLabel = 'Failed after',
  status = 'working',
  pattern = 'orbit',
  grid = 3,
  shape = 'round',
  color = 'currentColor',
  doneColor = '#22c55e',
  errorColor = '#ef4444',
  cellSize = 4,
  gap = 2,
  fontSize = 14,
  step = 90,
  idleOpacity = 0.15,
  glow = false,
  glowColor = '',
  showTimer = true,
  startedAt,
  className,
  style,
}: LatticeLoaderProps) {
  const n: Grid = grid === 4 ? 4 : 3;
  const pat = resolvePattern(pattern, n);
  const marks = MARKS[n];
  const d = step * pat.scale;
  const cycle = Math.round(pat.loop * d);

  const timerRef = useRef<HTMLSpanElement>(null);
  const dsRef = useRef(0);
  const markRef = useRef<'done' | 'error'>('done');
  const mark = status === 'working' ? markRef.current : status;
  markRef.current = mark;
  const [announce, setAnnounce] = useState(`${label}, in progress`);

  useLayoutEffect(() => {
    if (status !== 'working') return undefined;
    const origin = performance.now() - (startedAt ? Math.max(0, Date.now() - startedAt) : 0);
    const paint = () => {
      dsRef.current = Math.floor((performance.now() - origin) / 100);
      if (timerRef.current) timerRef.current.textContent = fmt(dsRef.current);
    };
    paint();
    const id = setInterval(paint, 100);
    return () => clearInterval(id);
  }, [status, startedAt]);

  useEffect(() => {
    if (status === 'working') setAnnounce(`${label}, in progress`);
    else
      setAnnounce(
        `${status === 'done' ? doneLabel : errorLabel}${showTimer ? ` ${spoken(dsRef.current)}` : ''}`,
      );
    // Announce on a status change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <span
      role="status"
      className={cn(styles.root, className)}
      data-status={status}
      data-shape={shape}
      data-glow={glow ? '' : undefined}
      style={
        {
          '--ll-n': n,
          '--ll-cell': `${cellSize}px`,
          '--ll-gap': `${gap}px`,
          '--ll-font': `${fontSize}px`,
          '--ll-color': color,
          '--ll-mark': status === 'error' ? errorColor : doneColor,
          '--ll-idle': idleOpacity,
          '--ll-glow': glowColor || color,
          '--ll-mark-glow': glowColor || (status === 'error' ? errorColor : doneColor),
          '--ll-cycle': `${cycle}ms`,
          ...style,
        } as CSSProperties
      }
    >
      <span className={styles.grid} aria-hidden="true">
        <span className={cn(styles.layer, styles.run)}>
          {pat.cells.map((unit, i) => (
            <span
              key={i}
              className={styles.cell}
              data-hole={unit == null ? '' : undefined}
              data-lit={pat.lit && pat.lit !== 0.62 ? Math.round(pat.lit * 100) : undefined}
              style={unit == null ? undefined : { animationDelay: `${Math.round(unit * d)}ms` }}
            />
          ))}
        </span>
        <span className={cn(styles.layer, styles.mark)}>
          {pat.cells.map((_, i) => (
            <span key={i} className={styles.cell} data-on={marks[mark].includes(i) ? '' : undefined} />
          ))}
        </span>
      </span>
      {label && (
        <span className={styles.label} aria-hidden="true">
          <span className={styles.text} data-active={status === 'working' ? '' : undefined}>
            {label}
          </span>
          <span className={styles.text} data-active={status === 'done' ? '' : undefined}>
            {doneLabel}
          </span>
          <span className={styles.text} data-active={status === 'error' ? '' : undefined}>
            {errorLabel}
          </span>
        </span>
      )}
      {showTimer ? (
        <span ref={timerRef} className={styles.timer} aria-hidden="true">
          0.0s
        </span>
      ) : null}
      <span className={styles.sr}>{announce}</span>
    </span>
  );
}
