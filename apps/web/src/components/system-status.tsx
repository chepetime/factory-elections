'use client';
// System status: runs every check (doctor, engine, project profiles) and shows a summary, a
// one-glance strip with a segment per check, and grouped rows with how to fix what failed.
import { CircleCheck, CircleX, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { summarize, type CheckGroup, type CheckStatus, type StatusReport } from '@/lib/status-checks';
import { cn } from '@/lib/utils';

const GROUPS: { group: CheckGroup; hint: string }[] = [
  { group: 'Environment', hint: 'Tools the factory runs on this machine' },
  { group: 'Engine', hint: 'The local engine and the web app’s link to it' },
  { group: 'Projects', hint: 'Each registered repository and its approved profile' },
];

const TONE: Record<
  CheckStatus,
  { icon: typeof CircleCheck; text: string; bar: string; soft: string; label: string }
> = {
  ok: {
    icon: CircleCheck,
    text: 'text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500',
    soft: 'bg-emerald-500/10',
    label: 'OK',
  },
  warn: {
    icon: TriangleAlert,
    text: 'text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500',
    soft: 'bg-amber-500/10',
    label: 'Warning',
  },
  fail: {
    icon: CircleX,
    text: 'text-destructive',
    bar: 'bg-destructive',
    soft: 'bg-destructive/10',
    label: 'Failed',
  },
};

/** Renders `code` spans in CLI hints. */
function hint(text: string): ReactNode {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground">
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function since(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function SystemStatus() {
  const [report, setReport] = useState<StatusReport>();
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const reduce = useReducedMotion();

  const run = useCallback(async () => {
    setRunning(true);
    setError(undefined);
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (!r.ok) throw new Error(`Status check failed (${r.status})`);
      setReport((await r.json()) as StatusReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status check failed');
    } finally {
      setRunning(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const checks = report?.checks ?? [];
  const sum = summarize(checks);
  const tone = TONE[error ? 'fail' : sum.status];
  const Icon = running && !report ? LoaderCircle : tone.icon;
  const headline = error
    ? report
      ? 'Checks unavailable — showing last results'
      : 'Checks unavailable'
    : !report
      ? 'Running checks…'
      : sum.status === 'ok'
        ? 'All systems go'
        : `${sum.failing + sum.warning} check${sum.failing + sum.warning === 1 ? '' : 's'} need${sum.failing + sum.warning === 1 ? 's' : ''} attention`;

  return (
    <LazyMotion features={domAnimation}>
      <section
        aria-labelledby="system-status"
        className="overflow-hidden rounded-2xl border bg-card shadow-xs"
      >
        <div className="flex flex-wrap items-center gap-4 p-5">
          <span
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full',
              report ? tone.soft : 'bg-muted',
              report ? tone.text : 'text-muted-foreground',
            )}
          >
            <Icon className={cn('size-6', running && !report && 'motion-safe:animate-spin')} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="system-status" className="text-base font-semibold">
              {headline}
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
              {report
                ? `${checks.length} checks · ${sum.failing} failed · ${sum.warning} warning${sum.warning === 1 ? '' : 's'} · checked ${since(report.checkedAt, now)}`
                : 'Checking tools, the engine and your projects'}
            </p>
          </div>
          <Button variant="outline" onClick={() => void run()} disabled={running}>
            <RefreshCw className={cn(running && 'motion-safe:animate-spin')} aria-hidden />
            {running ? 'Checking…' : 'Run checks'}
          </Button>
        </div>

        {/* One segment per check, in row order: the whole system at a glance. */}
        <div className="flex h-1.5 gap-0.5 px-5" aria-hidden>
          {report
            ? checks.map((c, i) => (
                <m.span
                  key={c.id}
                  className={cn('h-full flex-1 origin-left rounded-full', TONE[c.status].bar)}
                  initial={reduce ? false : { scaleX: 0, opacity: 0.4 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ delay: i * 0.04, duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                />
              ))
            : Array.from({ length: 10 }, (_, i) => (
                <span key={i} className="h-full flex-1 rounded-full bg-muted motion-safe:animate-pulse" />
              ))}
        </div>

        {error && (
          <p
            role="alert"
            className="mx-5 mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <div className="mt-4 divide-y border-t">
          {GROUPS.map(({ group, hint: groupHint }) => {
            const rows = checks.filter((c) => c.group === group);
            const groupSum = summarize(rows);
            return (
              <div key={group} className="px-5 py-4">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-medium">{group}</h3>
                  <span className="text-xs text-muted-foreground">
                    {report
                      ? `${rows.length - groupSum.failing - groupSum.warning}/${rows.length} OK`
                      : groupHint}
                  </span>
                </div>
                {!report ? (
                  <ul className="flex flex-col gap-2" aria-hidden>
                    {[0, 1].map((i) => (
                      <li key={i} className="flex items-center gap-3">
                        <span className="size-4 rounded-full bg-muted motion-safe:animate-pulse" />
                        <span className="h-3 w-40 rounded bg-muted motion-safe:animate-pulse" />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="flex flex-col">
                    {rows.map((c, i) => {
                      const T = TONE[c.status];
                      const RowIcon = running ? LoaderCircle : T.icon;
                      return (
                        <m.li
                          key={c.id}
                          initial={reduce ? false : { opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03, duration: 0.2 }}
                          className="flex gap-3 rounded-lg py-1.5"
                        >
                          <RowIcon
                            className={cn(
                              'mt-0.5 size-4 shrink-0',
                              running ? 'text-muted-foreground motion-safe:animate-spin' : T.text,
                            )}
                            role="img"
                            aria-label={running ? 'Checking' : T.label}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-3">
                              <span className="text-sm font-medium">{c.name}</span>
                              <span
                                className="min-w-0 truncate text-sm text-muted-foreground"
                                title={c.detail}
                              >
                                {c.detail}
                              </span>
                            </div>
                            {c.status !== 'ok' && c.fix && (
                              <p className={cn('mt-1 rounded-md px-2.5 py-1.5 text-xs', T.soft)}>
                                <span className="font-medium">Fix: </span>
                                {hint(c.fix)}
                              </p>
                            )}
                          </div>
                        </m.li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </LazyMotion>
  );
}
