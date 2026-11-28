'use client';
// The emergency stop: a hold button on the rail stops every agent the factory runs and holds new
// work; while it holds, a banner on every page says so and offers Resume. One provider polls the
// switch so the rail and the banner agree, and another tab's press shows up within seconds.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { OctagonX } from 'lucide-react';
import type { EmergencyStopCounts, EmergencyStopState } from '@factory/core';
import { Button } from '@factory/ui/components/button';
import { DESTRUCTIVE_HOLD, HoldButton } from '@factory/ui/components/hold-button';
import { cn } from '@factory/ui/lib/utils';
import { emergencyStop, resumeFactory, type EmergencyActionState } from '@/app/emergency-actions';

const POLL_MS = 5_000;

type Switch = {
  state: EmergencyStopState | undefined;
  error: string | undefined;
  pending: boolean;
  press(): void;
  resume(): void;
};

const SwitchContext = createContext<Switch | undefined>(undefined);

export function EmergencyStopProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** The switch before the first poll returns. */
  initial?: EmergencyStopState;
}) {
  const [state, setState] = useState<EmergencyStopState | undefined>(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const read = useCallback(async () => {
    try {
      const response = await fetch('/api/emergency-stop', { cache: 'no-store' });
      if (response.ok) setState((await response.json()) as EmergencyStopState);
    } catch {
      // Offline or the backend is down: keep the last known state.
    }
  }, []);

  useEffect(() => {
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    const onFocus = () => void read();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [read]);

  const act = (action: () => Promise<EmergencyActionState>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      if (result.state) setState(result.state);
    });

  return (
    <SwitchContext.Provider
      value={{ state, error, pending, press: () => act(emergencyStop), resume: () => act(resumeFactory) }}
    >
      {children}
    </SwitchContext.Provider>
  );
}

function useSwitch(): Switch {
  const value = useContext(SwitchContext);
  if (!value) throw new Error('EmergencyStopProvider is missing');
  return value;
}

/** The rail's control: hold to stop everything; while the stop holds, a red mark in its place. */
export function EmergencyStopButton() {
  const { state, pending, press } = useSwitch();
  if (state?.on)
    return (
      <span
        role="img"
        aria-label="Emergency stop is on"
        title="Emergency stop is on. Resume from the banner."
        className="mb-2 flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white pointer-coarse:size-11"
      >
        <OctagonX aria-hidden className="size-4" />
      </span>
    );
  return (
    <HoldButton
      {...DESTRUCTIVE_HOLD}
      size="icon"
      backgroundColor="transparent"
      textColor="var(--color-neutral-400)"
      fillColor="var(--color-red-600)"
      fillTextColor="#fff"
      fillDirection="up"
      doneLabel={<OctagonX aria-hidden className="size-4" />}
      resetAfter={0}
      disabled={pending}
      aria-label="Emergency stop: hold to stop every agent"
      title="Emergency stop: hold to stop every agent and hold new work"
      className="mb-2 shrink-0"
      onHold={press}
    >
      <OctagonX aria-hidden className="size-4" />
    </HoldButton>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** What the press interrupted, in one sentence. */
function stoppedText({ runs, reviews, executions }: EmergencyStopCounts): string {
  if (!runs && !reviews && !executions) return 'Nothing was running.';
  return `It stopped ${plural(runs, 'task run')}, ${plural(reviews, 'review')} and ${plural(executions, 'other agent')}.`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Across the top of every page while the stop holds, or when pressing it failed. */
export function EmergencyStopBanner() {
  const { state, error, pending, resume } = useSwitch();
  if (!state?.on && !error) return null;
  const stopped = state?.stopped;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-sm',
        state?.on
          ? 'border-red-700 bg-red-600 text-white'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
    >
      <OctagonX aria-hidden className="size-4 shrink-0" />
      {state?.on ? (
        <p className="min-w-0 flex-1">
          <strong className="font-semibold">Emergency stop is on</strong>
          {/* In parentheses: a locale's time can end in a period ("8:55 p.m."). */}
          {state.since ? ` (since ${time(state.since)})` : ''}. No agent runs and nothing starts until you
          resume.
          {stopped && ` ${stoppedText(stopped)}`}
          {error && <span className="block">{error}</span>}
        </p>
      ) : (
        <p className="min-w-0 flex-1">{error}</p>
      )}
      {state?.on && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={resume}>
          {pending ? 'Resuming…' : 'Resume factory'}
        </Button>
      )}
    </div>
  );
}
