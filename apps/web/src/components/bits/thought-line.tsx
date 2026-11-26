'use client';
// "Thinking… 4.2s" that breathes while an agent works, with a trace of its steps beneath, then
// settles into "Thought for 12.3s" and folds the trace into the line. Ported to TypeScript from
// React Bits' ThoughtLine (https://reactbits.dev, MIT + Commons Clause), with lucide icons in place
// of Hugeicons. Addition: `startedAt` starts the clock at a known time, for work that began before
// the page opened.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { animate, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './thought-line.module.css';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
const GLYPH_DONE = 0.55;
const EMPTY_STEPS: string[] = [];

/** Tenths of a second as "4.2s" or "1m 3.0s". */
const fmt = (ds: number) =>
  ds < 600 ? `${(ds / 10).toFixed(1)}s` : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`;
const spoken = (ds: number) =>
  ds < 600
    ? `${(ds / 10).toFixed(1)} seconds`
    : `${Math.floor(ds / 600)} minutes ${((ds % 600) / 10).toFixed(1)} seconds`;

export interface ThoughtLineProps {
  /** The working line. It breathes, and it is the spoken text. */
  label?: string;
  /** The settled line. Empty gives "Thought for", or "Done thinking" without the timer. */
  doneLabel?: string;
  glyph?: 'sparkle' | 'dot' | 'none' | ReactNode;
  /** The trace: the last step is current while working, earlier ones are ticked. */
  steps?: readonly string[];
  /** The line toggles the trace, with a chevron. */
  collapsible?: boolean;
  /** Fold the trace when the line settles. */
  collapseOnSettle?: boolean;
  color?: string;
  glyphColor?: string;
  /** Type size in px. Everything scales in em. */
  fontSize?: number;
  breathPeriod?: number;
  breathDepth?: number;
  shimmer?: boolean;
  shimmerDuration?: number;
  settleDuration?: number;
  settleBlur?: number;
  working?: boolean;
  /** Epoch ms the work started, so the clock includes time before the page opened. */
  startedAt?: number;
  showTimer?: boolean;
  /** Once per settle, with the frozen time in seconds. */
  onSettle?: (seconds: number) => void;
  className?: string;
  style?: CSSProperties;
}

export function ThoughtLine({
  label = 'Thinking…',
  doneLabel = '',
  glyph = 'sparkle',
  steps = EMPTY_STEPS,
  collapsible = true,
  collapseOnSettle = true,
  color = 'currentColor',
  glyphColor = '',
  fontSize = 16,
  breathPeriod = 1.6,
  breathDepth = 0.45,
  shimmer = true,
  shimmerDuration = 1.8,
  settleDuration = 350,
  settleBlur = 2,
  working = true,
  startedAt,
  showTimer = true,
  onSettle,
  className,
  style,
}: ThoughtLineProps) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(working || !collapseOnSettle);
  const doneText = doneLabel || (showTimer ? 'Thought for' : 'Done thinking');
  const hasTrace = steps.length > 0;
  const depth = reduce ? Math.min(breathDepth, 0.2) : breathDepth;
  const period = reduce ? breathPeriod * 1.5 : breathPeriod;
  const trough = 1 - depth;
  const sheen = shimmer && !reduce;

  const glyphRef = useRef<HTMLSpanElement>(null);
  const breathRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const stackRef = useRef<HTMLSpanElement>(null);
  const workRef = useRef<HTMLSpanElement>(null);
  const doneRef = useRef<HTMLSpanElement>(null);
  const dsRef = useRef(0);
  const prevWorking = useRef(working);
  const latest = useRef({ onSettle });
  latest.current = { onSettle };
  const [announce, setAnnounce] = useState(working ? label : doneText);

  useEffect(() => {
    if (working) setOpen(true);
    else if (collapseOnSettle) setOpen(false);
  }, [working, collapseOnSettle]);

  useEffect(() => {
    const glyphEl = glyphRef.current;
    const breathEl = breathRef.current;
    if (!breathEl) return undefined;
    const s = settleDuration / 1000;
    const loop = (el: HTMLElement, delay: number) =>
      animate(
        el,
        { opacity: [trough, 1, trough] },
        { duration: period, ease: EASE_IN_OUT, repeat: Infinity, delay },
      );
    let cancelled = false;
    const running: AnimationPlaybackControls[] = [];
    if (working) {
      if (depth > 0) {
        if (sheen) running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
        if (glyphEl) {
          const lead = animate(glyphEl, { opacity: trough }, { duration: 0.2, ease: EASE_OUT });
          running.push(lead);
          void lead.then(() => {
            if (cancelled) return;
            running.push(loop(glyphEl, 0));
            if (!sheen) running.push(loop(breathEl, 0.14));
          });
        } else if (!sheen) {
          running.push(loop(breathEl, 0.14));
        }
      } else {
        if (glyphEl) running.push(animate(glyphEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
        running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
      }
    } else {
      if (glyphEl) running.push(animate(glyphEl, { opacity: GLYPH_DONE }, { duration: s, ease: EASE_OUT }));
      running.push(animate(breathEl, { opacity: 1 }, { duration: s, ease: EASE_OUT }));
    }
    return () => {
      cancelled = true;
      running.forEach((a) => a.stop());
    };
  }, [working, period, depth, trough, settleDuration, glyph, sheen]);

  const paint = (ds: number) => {
    dsRef.current = ds;
    if (timerRef.current) timerRef.current.textContent = fmt(ds);
  };
  useLayoutEffect(() => {
    if (!working) return undefined;
    // performance.now() and Date.now() tick together, so a wall-clock start maps onto the page clock.
    const origin = performance.now() - (startedAt ? Math.max(0, Date.now() - startedAt) : 0);
    const tick = () => paint(Math.floor((performance.now() - origin) / 100));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [working, startedAt]);

  useLayoutEffect(() => {
    const t = timerRef.current;
    const stack = stackRef.current;
    if (!t || !stack) return undefined;
    const place = (glide: boolean) => {
      const active = working ? workRef.current : doneRef.current;
      if (!active) return;
      const shift = active.offsetWidth - stack.offsetWidth;
      if (!glide) t.style.transition = 'none';
      t.style.transform = `translateX(${shift}px)`;
      if (!glide) {
        void t.offsetWidth;
        t.style.transition = '';
      }
    };
    place(prevWorking.current !== working);
    prevWorking.current = working;
    const ro = new ResizeObserver(() => place(false));
    if (workRef.current) ro.observe(workRef.current);
    if (doneRef.current) ro.observe(doneRef.current);
    return () => ro.disconnect();
  }, [working, label, doneText, fontSize, showTimer]);

  const settledOnce = useRef(!working);
  useEffect(() => {
    if (working) {
      settledOnce.current = false;
      setAnnounce(label);
      return;
    }
    if (settledOnce.current) return;
    settledOnce.current = true;
    setAnnounce(showTimer ? `${doneText} ${spoken(dsRef.current)}` : doneText);
    latest.current.onSettle?.(dsRef.current / 10);
    // Announce on the change only; the label texts can change while it works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);

  const toggle = hasTrace && collapsible;
  const head = (
    <>
      {glyph !== 'none' ? (
        <span ref={glyphRef} className={styles.glyph} aria-hidden="true">
          {glyph === 'sparkle' ? (
            <Sparkles strokeWidth={2} />
          ) : glyph === 'dot' ? (
            <span className={styles.dot} />
          ) : (
            (glyph as ReactNode)
          )}
        </span>
      ) : null}
      <span ref={stackRef} className={styles.label} aria-hidden="true">
        <span ref={workRef} className={styles.text} data-active={working ? '' : undefined}>
          <span ref={breathRef} className={styles.breath} data-shimmer={sheen ? '' : undefined}>
            {label}
          </span>
        </span>
        <span
          ref={doneRef}
          className={cn(styles.text, styles.textDone)}
          data-active={working ? undefined : ''}
        >
          {doneText}
        </span>
      </span>
      {showTimer ? (
        <span ref={timerRef} className={styles.timer} data-done={working ? undefined : ''} aria-hidden="true">
          0.0s
        </span>
      ) : null}
      {collapsible ? (
        <span className={styles.chevron} data-on={hasTrace ? '' : undefined} aria-hidden="true">
          <ChevronDown size="1em" strokeWidth={2.2} />
        </span>
      ) : null}
      <span className={styles.sr} role="status">
        {announce}
      </span>
    </>
  );

  return (
    <div
      className={cn(styles.root, className)}
      data-working={working ? '' : undefined}
      data-open={open && hasTrace ? '' : undefined}
      style={
        {
          '--tl-font': `${fontSize}px`,
          '--tl-color': color,
          '--tl-glyph': glyphColor || color,
          '--tl-settle': `${settleDuration}ms`,
          '--tl-blur': `${settleBlur}px`,
          '--tl-shimmer': `${shimmerDuration}s`,
          ...style,
        } as CSSProperties
      }
    >
      {/* A button from the start, so the first step does not remount the breathing glyph. */}
      {collapsible ? (
        <button
          type="button"
          className={styles.head}
          data-toggle={toggle ? '' : undefined}
          aria-expanded={toggle ? open : undefined}
          tabIndex={toggle ? 0 : -1}
          onClick={() => {
            if (toggle) setOpen((v) => !v);
          }}
        >
          {head}
        </button>
      ) : (
        <div className={styles.head}>{head}</div>
      )}
      {hasTrace ? (
        <div className={styles.trace} data-open={open ? '' : undefined} aria-hidden={!open}>
          <div className={styles.fold}>
            <ol className={styles.steps}>
              {steps.map((text, i) => {
                const done = !working || i < steps.length - 1;
                return (
                  <li key={`${i}-${text}`} className={styles.step} data-done={done ? '' : undefined}>
                    <span className={styles.mark} aria-hidden="true">
                      {done ? <Check size="1em" strokeWidth={2.5} /> : <i className={styles.pulse} />}
                    </span>
                    <span className={styles.stepText}>{text}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}
