'use client';
// The running turn on the task page. It polls a small JSON route for new output and activity,
// and reloads the page only when the task itself changes (a new stage, the run finished).
import { ThinkingLoader } from '@factory/affect-ui/components/thinking-loader-clean';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LiveOutput } from '@/components/live-output';
import { livePollOutcome, runStatus, type LivePoll, type RunActivity } from '@/lib/task-chat';
import { cn } from '@/lib/utils';

interface LiveState {
  logTail?: string;
  activity?: RunActivity;
}

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
            if (outcome === 'reload') {
              router.refresh();
              return;
            }
            setLive(outcome);
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
  return (
    <div data-live-run="">
      <div className="affect-ui-theme">
        <ThinkingLoader phases={[label ?? 'Working']} variant="plain" size="sm" />
      </div>
      {status.text && (
        <p className="mt-1 flex min-w-0 gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate font-mono" title={status.text}>
            Now: {status.text}
          </span>
          {status.elapsed && <span className="shrink-0 tabular-nums">· {status.elapsed}</span>}
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
