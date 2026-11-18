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
