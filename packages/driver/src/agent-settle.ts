// A workspace agent's turn that changed nothing is steered once before it blocks the task: a
// progress note ("tests still run; I commit next") looks the same as "nothing to do". The signals
// are recorded state, never an agent's claim (ADR 0103): commits on the branch, what the agent
// reported with set_status, and whether it posted a comment. The steer is a Factory message in the
// same session, like a fix turn, and the attempt records `no_change_steered` so a restart cannot
// grant another.
import type { AgentEvent, TaskRecord } from '@factory/core';
import { tail } from './support.ts';

/** Sent when a turn changed nothing and the agent did not ask a question. */
export const STEER_PROMPT =
  'Your turn changed nothing. If the work is in progress, finish it and commit. ' +
  'Background work from your last turn has stopped; run it in the foreground. ' +
  'If no change is needed, say why, then call set_status blocked.';

/**
 * Work the turn started in the background, from its events: a `Bash` call with
 * `run_in_background`, or a subagent started the same way. The CLI stops it when the call ends.
 * Only the launch is recorded: the events carry no later signal that it finished.
 */
export function backgroundWork(events: readonly AgentEvent[]): string[] {
  const found: string[] = [];
  for (const e of events) {
    if (e.type !== 'tool' || e.input.run_in_background !== true) continue;
    if (e.name === 'Bash') found.push(`Bash: ${tail(String(e.input.command ?? ''), 120)}`);
    else if (e.name === 'Task' || e.name === 'Agent')
      found.push(`${e.name}: ${String(e.input.description ?? 'subagent')}`);
  }
  return found;
}

export function steerPrompt(background: readonly string[]): string {
  if (!background.length) return STEER_PROMPT;
  return `${STEER_PROMPT}\n\nYou started this in the background last turn, and it has stopped:\n${background.map((b) => `- ${b}`).join('\n')}`;
}

/**
 * Whether a no-change turn gets the steer: while fix turns are left, unless the agent asked a real
 * question (`blocked` with a comment), and only once per no-change (the previous attempt did not
 * steer already, so a restart or a later turn settles).
 */
export function steersNoChange(input: {
  task: TaskRecord;
  asked: 'in_progress' | 'in_review' | 'blocked' | undefined;
  commented: boolean;
  turnsLeft: number;
}): boolean {
  if (input.turnsLeft <= 0 || input.task.attempts?.at(-1)?.no_change_steered) return false;
  return !(input.asked === 'blocked' && input.commented);
}

/** The blocked message for a no-change turn that was already steered: with the agent's last words. */
export function noChangeBlocked(name: string, asked: string | undefined, report: string): string {
  const head =
    asked === 'blocked'
      ? `${name} needs you. Reply on the task to continue.`
      : `${name} made no changes. Reply on the task to continue.`;
  return report ? `${head}\n${name}'s last message:\n${tail(report, 2000)}` : head;
}
