// Turns a task record's event log into a conversation: your prompt, revision notes and decisions
// are your messages; everything the factory did in between is grouped into one agent turn.
import type { TaskRecord } from '@factory/core';

export type StepTone = 'neutral' | 'success' | 'danger' | 'attention';

export interface AgentStep {
  id: string;
  at: string;
  kind: string;
  text: string;
  tone: StepTone;
  href?: string;
  /** Command output after the first line of the message, shown as a code block. */
  output?: string;
}

export type ChatEntry =
  | { role: 'user'; id: string; at?: string; label?: string; text: string }
  | { role: 'agent'; id: string; at: string; steps: AgentStep[] };

const USER_KINDS = new Set(['revision', 'stage:approved', 'stage:rejected']);
const DANGER = new Set(['stage:failed', 'stage:verification-failed', 'stage:blocked']);

function tone(kind: string, text: string): StepTone {
  if (DANGER.has(kind) || (kind === 'verification' && !/passed/i.test(text))) return 'danger';
  if (kind === 'stage:awaiting-approval') return 'attention';
  if (kind === 'stage:pr-opened' || kind === 'verification') return 'success';
  return 'neutral';
}

// Terminal color and cursor codes from captured command output.
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');

/** Removes terminal color and cursor codes. */
export const stripAnsi = (text: string) => text.replace(ANSI, '');

// Log lines that say what the run is doing: a command, a coder tool call, or a workflow step.
const ACTIVITY = /^(\$ |Coder attempt|Verifying|Reviewing|Classifying|Writing|Opening|\s+· )/;

/** The latest activity line in a run log, for a "Now:" line above the live output. */
export function latestActivity(log: string): string | undefined {
  const line = stripAnsi(log)
    .split('\n')
    .findLast((text) => ACTIVITY.test(text));
  if (!line) return undefined;
  const text = line.replace(/^\s+· /, '').trimEnd();
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/** What the backend reports about an executing run. */
export interface RunActivity {
  run_started_at: string;
  command?: string;
  command_started_at?: string;
  last_output_at?: string;
}

/** A command or run silent this long gets a visible "still running" notice. */
export const QUIET_MS = 3 * 60_000;

/** "45s", "14m", "1h 5m". */
export function shortDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * The "Now:" line: the running command (or the latest log activity), how long it has run, and
 * how long nothing was printed. `quiet` means silent long enough to tell the person.
 */
export function runStatus(
  activity: RunActivity | undefined,
  log: string,
  now: number,
): { text?: string; elapsed?: string; silent?: string; quiet: boolean } {
  const text = activity?.command ? `$ ${activity.command}` : latestActivity(log);
  const since = activity ? Date.parse(activity.command_started_at ?? activity.run_started_at) : NaN;
  const heard = activity
    ? Date.parse(activity.last_output_at ?? activity.command_started_at ?? activity.run_started_at)
    : NaN;
  const silence = Number.isFinite(heard) ? now - heard : 0;
  return {
    ...(text ? { text } : {}),
    ...(Number.isFinite(since) ? { elapsed: shortDuration(now - since) } : {}),
    ...(silence >= 60_000 ? { silent: shortDuration(silence) } : {}),
    quiet: silence >= QUIET_MS,
  };
}

export interface StageStep {
  id: string;
  parent?: string;
  title: string;
  status: 'done' | 'running' | 'failed';
  /** Milliseconds since the first stage. */
  at?: number;
}

// Stages that last while the run works on them; any other stage is already finished.
const WORKING = new Set(['stage:queued', 'stage:classified', 'stage:coding', 'stage:reviewing']);

/**
 * The stage timeline. While a run works, its current stage shows as running; when the latest
 * stage is already finished (a revision after a failure), a running step for the run is added.
 */
export function stageTimeline(
  events: TaskRecord['events'],
  run: { busy: boolean; label: string; now: number },
): StageStep[] {
  const stages = (events ?? []).filter((event) => event.kind.startsWith('stage:'));
  const start = stages.length ? Date.parse(stages[0]!.at) : run.now;
  const since = (at: number) =>
    Number.isFinite(start) && Number.isFinite(at) ? Math.max(0, at - start) : undefined;
  const steps: StageStep[] = stages.map((event, index) => {
    const at = since(Date.parse(event.at));
    return {
      id: `stage-${index}`,
      ...(index ? { parent: `stage-${index - 1}` } : {}),
      title: splitOutput(event.message).text || event.kind.slice(6),
      status: /failed|blocked|rejected/.test(event.kind) ? 'failed' : 'done',
      ...(at === undefined ? {} : { at }),
    };
  });
  if (!run.busy) return steps;
  const last = stages.at(-1);
  if (last && WORKING.has(last.kind)) {
    steps.at(-1)!.status = 'running';
    return steps;
  }
  const at = since(run.now);
  steps.push({
    id: 'stage-live',
    ...(steps.length ? { parent: steps.at(-1)!.id } : {}),
    title: run.label,
    status: 'running',
    ...(at === undefined ? {} : { at }),
  });
  return steps;
}

/** Splits a message into its first line and the command output that follows it, if any. */
export function splitOutput(message: string): { text: string; output?: string } {
  const newline = message.indexOf('\n');
  if (newline < 0) return { text: message };
  const output = message
    .slice(newline + 1)
    .replace(ANSI, '')
    .replace(/\s+$/, '');
  const text = message.slice(0, newline).trimEnd();
  return output.trim() ? { text, output } : { text };
}

export function taskConversation(task: TaskRecord): ChatEntry[] {
  const entries: ChatEntry[] = [{ role: 'user', id: 'prompt', at: task.created_at, text: task.prompt }];
  let turn: Extract<ChatEntry, { role: 'agent' }> | undefined;

  (task.events ?? []).forEach((event, i) => {
    const id = `e${i}`;
    // The prompt bubble already says the task was submitted.
    if (event.kind === 'stage:queued' && i === 0) return;
    if (USER_KINDS.has(event.kind)) {
      turn = undefined;
      const label =
        event.kind === 'revision'
          ? 'Asked for changes'
          : event.kind === 'stage:approved'
            ? 'Approved'
            : 'Rejected';
      const note = event.kind === 'stage:approved' ? task.approval?.note : undefined;
      entries.push({
        role: 'user',
        id,
        at: event.at,
        label,
        text: note ? `${event.message}\n\n${note}` : event.message,
      });
      return;
    }
    if (!turn) {
      turn = { role: 'agent', id, at: event.at, steps: [] };
      entries.push(turn);
    }
    const step: AgentStep = {
      id,
      at: event.at,
      kind: event.kind,
      ...splitOutput(event.message),
      tone: tone(event.kind, event.message),
    };
    if (event.kind === 'stage:pr-opened' && /^https?:\/\//.test(event.message)) step.href = event.message;
    turn.steps.push(step);
  });
  return entries;
}

/** The id of the last step of a kind, so details (review, blockers) attach to the latest one only. */
export function lastStepId(entries: ChatEntry[], kind: string): string | undefined {
  let found: string | undefined;
  for (const entry of entries)
    if (entry.role === 'agent') for (const step of entry.steps) if (step.kind === kind) found = step.id;
  return found;
}
