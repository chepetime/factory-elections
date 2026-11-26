'use client';
// The running turn on the task page. It polls a small JSON route for new output and activity,
// and reloads the page only when the task itself changes (a new stage, the run finished).
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThoughtLine } from '@/components/bits/thought-line';
import { LiveOutput } from '@/components/live-output';
import { livePollOutcome, runStatus, type LivePoll, type RunActivity } from '@/lib/task-chat';
import { cn } from '@/lib/utils';

interface LiveState {
  logTail?: string;
  activity?: RunActivity;
}

/** Steps kept under the run line; older ones scroll away. */
const MAX_STEPS = 6;

export function LiveRun({
  project,
  id,
  label,
  version,
  initial,
  renderedAt,
  everyMs = 2000,
}: {
  project: string;
  id: string;
  label?: string;
  /** The page version from the server. A different version from the poll reloads the page. */
  version: string;
  initial: LiveState;
  /** Server time of the render, so the first client render matches it. */
  renderedAt: number;
  everyMs?: number;
}) {
  const router = useRouter();
  const [live, setLive] = useState<LiveState>(initial);
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const response = await fetch(`/api/projects/${project}/tasks/${id}/live`, { cache: 'no-store' });
          if (stopped) return;
          if (response.ok) {
            const outcome = livePollOutcome(version, (await response.json()) as LivePoll);
            if (stopped) return;
            // Keep polling after a reload: if the page renders the same version, no new effect starts.
            if (outcome === 'reload') router.refresh();
            else setLive(outcome);
          }
        } catch {
          // A missed poll is harmless; the next one tries again.
        }
      }
      if (!stopped) timer = setTimeout(poll, everyMs);
    };
    timer = setTimeout(poll, everyMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [project, id, version, everyMs, router]);

  const status = runStatus(live.activity, live.logTail ?? '', now);
  // Each new "now" line becomes a step under the run line; the last one is the current step.
  const [steps, setSteps] = useState<string[]>(status.text ? [status.text] : []);
  if (status.text && steps.at(-1) !== status.text) setSteps([...steps, status.text].slice(-MAX_STEPS));
  const started = live.activity ? Date.parse(live.activity.run_started_at) : NaN;
  return (
    <div data-live-run="">
      <ThoughtLine
        label={label ?? 'Working'}
        steps={steps}
        {...(Number.isFinite(started) ? { startedAt: started } : {})}
        fontSize={14}
        className="text-muted-foreground [&_li]:font-mono [&_li]:text-xs"
      />
      {status.elapsed && (
        <p className="mt-1 flex min-w-0 gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 tabular-nums">This step: {status.elapsed}</span>
          {status.silent && (
            <span
              className={cn('shrink-0 tabular-nums', status.quiet && 'text-amber-700 dark:text-amber-400')}
            >
              · no output for {status.silent}
            </span>
          )}
        </p>
      )}
      {status.quiet && (
        <p
          role="status"
          className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          No output for {status.silent}. The command is still running, but it prints nothing. Stop the run if
          it should have finished; a command silent for the profile's stall limit is stopped anyway.
        </p>
      )}
      {live.logTail && <LiveOutput output={live.logTail} />}
    </div>
  );
}
