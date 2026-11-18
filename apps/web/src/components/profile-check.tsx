// "Check setup": preflight, setup, test and full check in a temporary worktree, no model call.
// It finds login, install and check problems before a paid run does.
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import { AutoRefresh } from '@/components/auto-refresh';
import { LiveOutput } from '@/components/live-output';
import { LocalTime } from '@/components/local-time';
import { OutputBlock } from '@/components/output-block';
import { ProfileCheckButton } from '@/components/profile-check-button';
import type { ProfileCheckState } from '@/lib/profile-check';
import { shortDuration } from '@/lib/task-chat';
import { cn } from '@/lib/utils';

const OUTCOME = {
  passed: { label: 'Passed', icon: CircleCheck, className: 'text-green-700 dark:text-green-400' },
  failed: { label: 'Failed', icon: CircleX, className: 'text-destructive' },
  skipped: { label: 'Skipped', icon: CircleDashed, className: 'text-muted-foreground' },
} as const;

export function ProfileCheckView({ project, state }: { project: string; state: ProfileCheckState }) {
  return (
    <section aria-labelledby="profile-check" className="rounded-xl border bg-card p-4 shadow-xs">
      {state.running && <AutoRefresh />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="profile-check" className="text-sm font-semibold">
            Check setup
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Runs the preflight checks, then setup, test and full check on the base branch in a temporary
            worktree. No model is called, so this costs nothing.
          </p>
          {!state.running && state.finished_at && (
            <p className="mt-1 text-xs">
              Last check:{' '}
              <span className={state.passed ? 'text-green-700 dark:text-green-400' : 'text-destructive'}>
                {state.passed ? 'passed' : 'failed'}
              </span>{' '}
              · <LocalTime iso={state.finished_at} format="date-time" />
            </p>
          )}
        </div>
        <ProfileCheckButton project={project} running={state.running} />
      </div>

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {state.error}
        </p>
      )}

      {state.steps.length > 0 && (
        <ol className="mt-3 flex flex-col gap-2">
          {state.steps.map((step, index) => {
            const outcome = OUTCOME[step.outcome];
            const Icon = outcome.icon;
            return (
              <li key={index} className="text-sm">
                <div className="flex items-center gap-2">
                  <Icon className={cn('size-4 shrink-0', outcome.className)} aria-hidden />
                  <span className="font-medium">{step.name}</span>
                  <span className={cn('text-xs', outcome.className)}>{outcome.label}</span>
                  {step.outcome !== 'skipped' && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      · {shortDuration(step.duration_ms)}
                    </span>
                  )}
                </div>
                {step.command && (
                  <p className="ml-6 truncate font-mono text-xs text-muted-foreground" title={step.command}>
                    {step.command}
                  </p>
                )}
                {step.environment && (
                  <p className="mt-1 ml-6 text-xs text-amber-800 dark:text-amber-300">
                    Machine fault: {step.environment}
                  </p>
                )}
                {step.outcome === 'failed' && step.output && (
                  <div className="ml-6">
                    <OutputBlock output={step.output} tone="danger" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {state.running && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">Checking… the output follows below.</p>
          {state.log && <LiveOutput output={state.log} />}
        </div>
      )}
    </section>
  );
}
