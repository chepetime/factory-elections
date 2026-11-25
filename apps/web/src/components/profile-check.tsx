// "Check setup": preflight, setup, test and full check in a temporary worktree, no model call.
// It finds login, install and check problems before a paid run does.
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import { AutoRefresh } from '@/components/auto-refresh';
import { LiveOutput } from '@/components/live-output';
import { LocalTime } from '@/components/local-time';
import { OutputBlock } from '@/components/output-block';
import { ProfileCheckButton } from '@/components/profile-check-button';
import { SettingsSection } from '@/components/settings-section';
import type { ProfileCheckState } from '@/lib/profile-check';
import { shortDuration } from '@/lib/task-chat';
import { cn } from '@/lib/utils';

const OUTCOME = {
  passed: { label: 'Passed', icon: CircleCheck, className: 'text-green-700 dark:text-green-400' },
  failed: { label: 'Failed', icon: CircleX, className: 'text-destructive' },
  skipped: { label: 'Skipped', icon: CircleDashed, className: 'text-muted-foreground' },
} as const;

export function ProfileCheckView({ project, state }: { project: string; state: ProfileCheckState }) {
  const finished = !state.running && state.finished_at;
  return (
    <SettingsSection
      id="profile-check"
      title="Setup check"
      description="Runs the preflight checks, then setup, test and full check on the base branch in a temporary worktree. No model is called, so it costs nothing."
      action={<ProfileCheckButton project={project} running={state.running} />}
    >
      {state.running && <AutoRefresh />}
      {finished && (
        <p className="text-sm">
          <span className="text-muted-foreground">Last check: </span>
          <span className={state.passed ? 'text-green-700 dark:text-green-400' : 'text-destructive'}>
            {state.passed ? 'passed' : 'failed'}
          </span>
          <span className="text-muted-foreground">
            {' '}
            · <LocalTime iso={finished} format="date-time" />
          </span>
        </p>
      )}
      {!state.running && !state.finished_at && !state.error && (
        <p className="text-sm text-muted-foreground">
          No check has run yet. Run one before the first task to catch login and install problems.
        </p>
      )}

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      {state.steps.length > 0 && (
        <ol className="flex flex-col gap-3">
          {state.steps.map((step, index) => {
            const outcome = OUTCOME[step.outcome];
            const Icon = outcome.icon;
            return (
              <li key={index} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 text-sm">
                <Icon className={cn('mt-0.5 size-4', outcome.className)} aria-hidden />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{step.name}</span>
                  <span className={cn('text-xs', outcome.className)}>{outcome.label}</span>
                  {step.outcome !== 'skipped' && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {shortDuration(step.duration_ms)}
                    </span>
                  )}
                </div>
                {step.command && (
                  <p
                    className="col-start-2 truncate font-mono text-xs text-muted-foreground"
                    title={step.command}
                  >
                    {step.command}
                  </p>
                )}
                {step.environment && (
                  <p className="col-start-2 mt-1 text-xs text-amber-800 dark:text-amber-300">
                    Machine fault: {step.environment}
                  </p>
                )}
                {step.outcome === 'failed' && step.output && (
                  <div className="col-start-2">
                    <OutputBlock output={step.output} tone="danger" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {state.running && (
        <div>
          <p className="text-sm text-muted-foreground">Checking… the output follows below.</p>
          {state.log && <LiveOutput output={state.log} />}
        </div>
      )}
    </SettingsSection>
  );
}
