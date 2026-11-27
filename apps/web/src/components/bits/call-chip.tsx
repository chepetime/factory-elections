'use client';
// One tool call as a chip: a fill wipes across while it runs, a wash and a check when it is done, a
// tint and a shake when it fails. Ported to TypeScript from React Bits' CallChip
// (https://reactbits.dev, MIT + Commons Clause), with lucide icons in place of Hugeicons. Two
// additions: `durationMs` shows a recorded time for a call that ended before the page opened, and
// the chip only announces a status it saw change, so a long transcript does not read every call.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, FileText, Pencil, RefreshCw, Search, SquareTerminal, X } from 'lucide-react';
import { cn } from '@factory/ui/lib/utils';
import styles from './call-chip.module.css';

export type CallStatus = 'idle' | 'running' | 'done' | 'error';
type Glyph = 'tool' | 'check' | 'retry' | 'cross';

const HOLD_AT = 0.9;
const SHAKE = [0, -1, 1, -0.66, 0.66, -0.33, 0];
const ICONS = { terminal: SquareTerminal, file: FileText, search: Search, edit: Pencil } as const;
const WORDS: Record<CallStatus, string> = {
  running: 'running',
  done: 'done',
  error: 'failed',
  idle: 'queued',
};

/** The chip glyph for a tool name: Claude Code's built-ins, then a terminal for anything else. */
export function iconForTool(name: string): keyof typeof ICONS {
  if (/^(Read|Write|NotebookRead)$/.test(name)) return 'file';
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(name)) return 'edit';
  if (/^(Grep|Glob|LS|WebSearch|WebFetch|ToolSearch)$/.test(name)) return 'search';
  return 'terminal';
}

const fmt = (ms: number) => (ms < 10000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
/** A failed call shows the retry arrow only when it can be retried; otherwise a cross. */
const glyphOf = (s: CallStatus, retry: boolean): Glyph =>
  s === 'done' ? 'check' : s === 'error' ? (retry ? 'retry' : 'cross') : 'tool';

export interface CallChipProps {
  /** The tool glyph; it rolls out when the call resolves. */
  icon?: keyof typeof ICONS | ReactNode;
  name: string;
  argument?: string;
  status: CallStatus;
  /** Milliseconds the fill takes to reach its 90% park: the time the call is expected to take. */
  expectedMs?: number;
  /** The call's recorded duration, shown once it is done or failed. */
  durationMs?: number;
  /** Chip height in px. Font, padding and glyph follow. */
  size?: number;
  radius?: number;
  color?: string;
  surfaceColor?: string;
  progressColor?: string;
  progressOpacity?: number;
  doneColor?: string;
  errorColor?: string;
  washOpacity?: number;
  /** Error shake amplitude in px. 0 tints only. */
  shake?: number;
  showTimer?: boolean;
  /** Announce status changes. Off inside a transcript that has its own live line. */
  announce?: boolean;
  /** When set, a failed chip becomes a retry button. */
  onRetry?: () => void;
  className?: string;
  style?: CSSProperties;
}

export function CallChip({
  icon = 'terminal',
  name,
  argument = '',
  status,
  expectedMs = 2500,
  durationMs,
  size = 34,
  radius = 10,
  color = 'currentColor',
  surfaceColor = '#27272a',
  progressColor = 'currentColor',
  progressOpacity = 0.08,
  doneColor = '#22c55e',
  errorColor = '#ef4444',
  washOpacity = 0.14,
  shake = 6,
  showTimer = true,
  announce: speak = true,
  onRetry,
  className,
  style,
}: CallChipProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const mountedRef = useRef(false);
  const fraction = useRef(0);
  const clock = useRef({ ms: 0 });
  const shakeAnim = useRef<Animation | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const [mounted, setMounted] = useState(false);
  const [pressed, setPressed] = useState(false);
  // A live region only after the chip saw the call run, so a transcript's old calls stay quiet.
  const [live, setLive] = useState(status === 'running');
  const [announce, setAnnounce] = useState(`${name} ${argument}, ${WORDS[status]}`);
  const glyph = glyphOf(status, Boolean(onRetry));
  const roll = useRef<{ cur: Glyph; prev: Glyph | null }>({ cur: glyph, prev: null });
  if (glyph !== roll.current.cur) roll.current = { cur: glyph, prev: roll.current.cur };

  const setFraction = (f: number, instant: boolean) => {
    const fill = fillRef.current;
    if (!fill) return;
    fraction.current = f;
    if (instant) fill.style.transition = 'none';
    fill.style.transform = `scaleX(${f})`;
    if (instant) {
      void fill.getBoundingClientRect();
      fill.style.transition = '';
    }
  };
  const apply = (s: CallStatus, animate: boolean) => {
    if (s === 'running') {
      shakeAnim.current?.cancel();
      setFraction(0, true);
      if (animate) setFraction(HOLD_AT, false);
    } else if (s === 'done') {
      setFraction(1, !animate);
    } else if (s === 'error') {
      const fill = fillRef.current;
      const current = fill ? new DOMMatrix(getComputedStyle(fill).transform).a : fraction.current;
      setFraction(Math.min(1, Math.max(0, current)), true);
      if (animate && shake > 0 && !reduceMotion() && rootRef.current) {
        shakeAnim.current = rootRef.current.animate(
          SHAKE.map((k) => ({
            transform: `translateX(${k * shake}px)`,
            easing: 'cubic-bezier(0.77, 0, 0.175, 1)',
          })),
          { duration: 450, composite: 'add' },
        );
      }
    } else setFraction(0, true);
  };

  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);
    apply(statusRef.current, statusRef.current === 'running');
    return () => {
      mountedRef.current = false;
      shakeAnim.current?.cancel();
    };
    // Mount only: later changes go through the layout effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    if (mountedRef.current) apply(status, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const write = (ms: number) => {
      clock.current.ms = ms;
      if (timerRef.current) timerRef.current.textContent = fmt(ms);
    };
    if (status !== 'running') {
      if (!clock.current.ms && durationMs !== undefined && status !== 'idle') write(durationMs);
      else if ((status === 'idle' || !clock.current.ms) && timerRef.current)
        timerRef.current.textContent = '—';
      return undefined;
    }
    setLive(true);
    const startedAt = performance.now();
    write(0);
    if (reduceMotion()) {
      const id = setInterval(() => write(performance.now() - startedAt), 100);
      return () => {
        clearInterval(id);
        write(performance.now() - startedAt);
      };
    }
    let raf = 0;
    const tick = () => {
      write(performance.now() - startedAt);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      write(performance.now() - startedAt);
    };
  }, [status, durationMs]);
  useEffect(() => {
    const ms = showTimer && clock.current.ms ? Math.round(clock.current.ms) : 0;
    const when = status === 'done' && ms ? ` in ${ms} ms` : status === 'error' && ms ? ` after ${ms} ms` : '';
    setAnnounce(`${name} ${argument}, ${WORDS[status]}${when}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const font = Math.max(11, Math.round(size * 0.38));
  const glyphState = (g: Glyph) =>
    g === roll.current.cur ? 'in' : g === roll.current.prev ? 'out' : undefined;
  const ToolIcon = typeof icon === 'string' && icon in ICONS ? ICONS[icon as keyof typeof ICONS] : null;
  const iconSize = font + 2;

  return (
    <span
      ref={rootRef}
      role={speak && live ? 'status' : undefined}
      aria-busy={status === 'running' || undefined}
      data-status={status}
      data-mounted={mounted ? '' : undefined}
      data-pressed={pressed ? '' : undefined}
      data-retry={onRetry ? '' : undefined}
      className={cn(styles.root, className)}
      style={
        {
          '--cc-size': `${size}px`,
          '--cc-font': `${font}px`,
          '--cc-pad': `${Math.round(size * 0.35)}px`,
          '--cc-gap': `${Math.round(font * 0.55)}px`,
          '--cc-radius': `${radius}px`,
          '--cc-color': color,
          '--cc-surface': surfaceColor,
          '--cc-progress': progressColor,
          '--cc-progress-pct': `${progressOpacity * 100}%`,
          '--cc-done': doneColor,
          '--cc-error': errorColor,
          '--cc-wash-pct': `${washOpacity * 100}%`,
          '--cc-expected': `${expectedMs}ms`,
          ...style,
        } as CSSProperties
      }
    >
      <span ref={fillRef} className={styles.fill} aria-hidden="true" />
      <span className={styles.slot} aria-hidden="true">
        <span className={styles.glyph} data-state={glyphState('tool')}>
          {ToolIcon ? <ToolIcon size={iconSize} strokeWidth={1.8} /> : (icon as ReactNode)}
        </span>
        <span className={styles.glyph} data-state={glyphState('check')}>
          <Check size={iconSize} strokeWidth={2.2} />
        </span>
        <span className={styles.glyph} data-state={glyphState('retry')}>
          <RefreshCw size={iconSize} strokeWidth={2} />
        </span>
        <span className={styles.glyph} data-state={glyphState('cross')}>
          <X size={iconSize} strokeWidth={2.2} />
        </span>
      </span>
      <span className={styles.name} aria-hidden="true">
        {name}
      </span>
      {argument && (
        <span className={styles.arg} aria-hidden="true" title={argument}>
          {argument}
        </span>
      )}
      {showTimer ? (
        <span ref={timerRef} className={styles.timer} aria-hidden="true">
          0 ms
        </span>
      ) : null}
      {status === 'error' && onRetry ? (
        <button
          type="button"
          className={styles.retry}
          aria-label={`Retry ${name} ${argument}`}
          onClick={() => onRetry()}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerCancel={() => setPressed(false)}
        />
      ) : null}
      <span className={styles.sr}>{announce}</span>
    </span>
  );
}
