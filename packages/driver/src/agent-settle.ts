// How a workspace agent's task session ends. The agent works in turns; after each turn the driver
// commits what changed and reads recorded state: commits on the branch and what the agent reported
// with set_status. A turn that changed nothing is steered once before it blocks the task, because a
// progress note ("tests still run; I commit next") looks the same as "nothing to do" (ADR 0103: the
// signal is recorded state, never an agent's claim).
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  isForbiddenPath,
  taskTitle,
  withEvent,
  withStage,
  type AgentEvent,
  type ModelResult,
  type ModelRun,
  type RepoProfile,
  type StepAttempt,
  type TaskRecord,
} from '@factory/core';
import { DriverError, type AgentSession, type DriverDeps } from './ports.ts';
import { errorCost, failureText, tail } from './support.ts';

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

/** Changed files that still hold a conflict marker line. */
async function conflictMarkers(dir: string, files: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8').catch(() => '');
    if (/^(<{7}|>{7}) /m.test(text) || /^={7}$/m.test(text)) found.push(file);
  }
  return found;
}

export interface AgentTurnsInput {
  project: string;
  id: string;
  path: string;
  branch: string;
  base: string;
  task: TaskRecord;
  profile: RepoProfile;
  session: AgentSession;
  /** Spend left for the task session, before this call. */
  left: number;
  /** Cost the task's delegate children have run up so far. */
  childSpent(): number;
  /** One model call with the step's guard, sandbox and limits already applied. */
  call(turn: Pick<ModelRun, 'prompt' | 'resume' | 'maxBudgetUsd' | 'onEvent'>): Promise<ModelResult>;
}

/**
 * Runs turns until the task settles. Returns the task record when the run left it in a final
 * stage (blocked, pr-opened); without it, the branch has a change and verification comes next.
 */
export async function runAgentTurns(
  deps: DriverDeps,
  c: AgentTurnsInput,
): Promise<{ final?: TaskRecord; task: TaskRecord; report: string }> {
  const { project, id, path, branch, session } = c;
  const name = session.name;
  let task = c.task;
  let sessionId = task.agent_session;
  let steered = task.attempts?.at(-1)?.no_change_steered === true;
  let prompt = session.prompt;
  let spent = 0;
  let childSeen = 0;
  for (;;) {
    const started = deps.now();
    let outcome: StepAttempt['outcome'] = 'completed';
    let error: string | undefined;
    let costUsd: number | null = null;
    let report = '';
    const events: AgentEvent[] = [];
    let saving: Promise<void> = Promise.resolve();
    try {
      const result = await c.call({
        prompt,
        maxBudgetUsd: Math.max(0.01, c.left - spent),
        ...(sessionId ? { resume: sessionId } : {}),
        // Save the session as soon as it exists: a stopped or crashed call must still resume it,
        // or the next reply starts an agent that remembers nothing of its own work.
        onEvent: (event) => {
          events.push(event);
          if (event.type !== 'session' || event.id === sessionId) return;
          sessionId = event.id;
          saving = saving.then(async () => {
            const current = await deps.tasks.read(project, id);
            await deps.tasks.write({ ...current, agent_session: event.id });
          });
        },
      });
      costUsd = result.costUsd;
      sessionId = result.sessionId ?? sessionId;
      report = result.text?.trim() ?? '';
    } catch (e) {
      outcome = 'failed';
      error = failureText(e);
      costUsd = errorCost(e);
    } finally {
      await saving.catch(() => undefined);
    }
    const childTotal = c.childSpent();
    const childCost = childTotal - childSeen;
    childSeen = childTotal;
    if (childCost) costUsd = (costUsd ?? 0) + childCost;
    spent += costUsd ?? 0;

    let committed = false;
    // A conflict follow-up leaves a merge in progress: the commit below completes it.
    const merging = (await deps.git.mergeInProgress?.(path)) ?? false;
    if (outcome === 'completed') {
      const changed = await deps.git.stageAll(path);
      const forbidden = changed.filter((file) => isForbiddenPath(file, c.profile.confirmed.forbidden_paths));
      const marked = merging ? await conflictMarkers(path, changed) : [];
      if (forbidden.length) {
        await deps.git.unstageAll(path);
        outcome = 'failed';
        error = `${name} changed forbidden paths: ${forbidden.join(', ')}`;
      } else if (marked.length) {
        outcome = 'failed';
        error = `conflict markers remain in ${marked.join(', ')}`;
      } else if (changed.length || merging) {
        await deps.git.commit(path, `${taskTitle(task)}\n\nFactory task ${task.id} (${name}).`);
        committed = true;
      }
    }

    const asked = outcome === 'completed' ? session.reported() : undefined;
    const upToDate = task.pr && asked !== 'blocked' && (await deps.git.headSha(path)) === task.pr.head_sha;
    // Whether this turn left the branch where it was, by recorded state.
    const idle =
      outcome === 'completed' &&
      !upToDate &&
      (asked === 'blocked'
        ? !committed && !session.commented?.()
        : (await deps.git.commitCountSince(path, c.base)) === 0);
    const steer = idle && !steered && c.left - spent > 0.01;
    task = await deps.tasks.read(project, id);
    const attempt: StepAttempt = {
      step: 'agent',
      rung: name,
      model: session.model,
      effort: session.effort,
      started_at: started,
      finished_at: deps.now(),
      outcome,
      cost_usd: costUsd,
      ...(error ? { error } : {}),
      // A steered turn that failed keeps the mark: a restart must not steer a second time.
      ...((idle && (steer || steered)) || (outcome === 'failed' && steered)
        ? { no_change_steered: true }
        : {}),
    };
    task = withEvent(
      {
        ...task,
        attempts: [...(task.attempts ?? []), attempt],
        ...(sessionId ? { agent_session: sessionId } : {}),
      },
      deps.now(),
      'attempt',
      `${name} ${outcome === 'failed' ? `stopped: ${error}` : 'finished'}${committed ? ` and Factory committed the rest on ${branch}` : ''}${steer ? '; nothing changed, so Factory asked it to carry on' : ''}`,
    );
    if (outcome === 'failed') {
      if (merging) await deps.git.abortMerge?.(path);
      await deps.tasks.write(withStage(task, deps.now(), 'failed', error ?? `${name} failed`));
      throw new DriverError(error ?? 'agent failed');
    }
    if (steer) {
      // Written now: a restart after this point must not steer a second time.
      await deps.tasks.write(task);
      steered = true;
      prompt = steerPrompt(backgroundWork(events));
      continue;
    }
    // A follow-up that changed nothing leaves the PR as it was: the task is done again.
    if (upToDate) {
      await deps.tasks.write(
        withStage(task, deps.now(), 'pr-opened', `${name} made no changes; the pull request is unchanged.`),
      );
      return { final: await deps.tasks.read(project, id), task, report };
    }
    if (asked === 'blocked' || idle) {
      const last = report ? `\n\n${name}'s last message:\n${tail(report, 2000)}` : '';
      const message =
        asked === 'blocked'
          ? `${name} needs you. Reply on the task to continue.${last}`
          : `${name} made no changes. Reply on the task to continue.${last}`;
      await deps.tasks.write(withStage(task, deps.now(), 'blocked', message));
      return { final: await deps.tasks.read(project, id), task, report };
    }
    return { task, report };
  }
}
