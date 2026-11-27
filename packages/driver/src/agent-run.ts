// Agent runs and follow-ups: one workspace agent session works the task, then the driver commits,
// verifies and gates it. Driver methods of the same names call these.
import { join } from 'node:path';
import {
  DEFAULT_STEP_LIMITS,
  protectedPaths,
  taskTitle,
  taskCommandBlockers,
  workSpend,
  withEvent,
  withStage,
  type StepAttempt,
  type FollowUpKind,
  followUpPushesItself,
  type TaskRecord,
} from '@factory/core';
import { readFile } from 'node:fs/promises';
import { DriverError } from './ports.ts';
import { MINUTE, errorCost, failureText } from './support.ts';
import { changeGate } from './verification.ts';
import { AGENT_FIX_TURNS, changeCheckTool, verificationSteer } from './agent-fixes.ts';
import { openPr } from './publication.ts';
import type { Driver } from './workflow.ts';

/** Changed files that still hold a conflict marker line. */
async function conflictMarkers(dir: string, files: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8').catch(() => '');
    if (/^(<{7}|>{7}) /m.test(text) || /^={7}$/m.test(text)) found.push(file);
  }
  return found;
}

/**
 * More work on a task whose PR is open, by a workspace agent on the same branch and PR (see
 * core follow-ups.ts). It starts from the PR head and refuses a branch that diverged from it. A
 * conflict follow-up merges the base first: a clean merge goes straight to verification, and
 * conflicts go to the agent. Either way the task stops at the approval gate with the new commit.
 */
export async function followUp(
  d: Driver,
  project: string,
  id: string,
  input: { note: string; kind: FollowUpKind; agent: string; by: string; prHead?: string },
): Promise<TaskRecord> {
  let task = await d.deps.tasks.read(project, id);
  const blockers = taskCommandBlockers(task, 'follow-up');
  if (blockers.length) throw new DriverError(blockers.map((b) => b.message).join('; '));
  const { git } = d.deps;
  if (!d.deps.agentSession || !git.fetchRefs || !git.fastForwardTo || !git.mergeRef)
    throw new DriverError('Follow-ups are not available here.');
  const { path, branch, base } = await d.checkedWorktree(task);
  if (!(await git.isClean(path))) throw new DriverError('the task worktree has uncommitted changes');
  // Start from the PR head: someone may have pushed to it since the factory did.
  await git.fetchRefs(path, [branch, base]);
  if (!(await git.fastForwardTo(path, `origin/${branch}`)))
    throw new DriverError(`the task branch has diverged from the pull request (origin/${branch})`);
  const changesAgent = task.workflow !== 'agent' || task.agent !== input.agent;
  const entry = {
    at: d.deps.now(),
    kind: input.kind,
    note: input.note,
    agent: input.agent,
    by: input.by,
    ...(input.prHead ? { pr_head: input.prHead } : {}),
  };
  task = withEvent(
    {
      ...task,
      workflow: 'agent',
      agent: input.agent,
      // Another agent starts its own session; the same agent keeps its context.
      ...(changesAgent ? { agent_session: undefined } : {}),
      approval: undefined,
      follow_ups: [...(task.follow_ups ?? []), entry],
    },
    d.deps.now(),
    'follow-up',
    `${input.by === 'factory' ? 'The factory' : 'You'} added a follow-up for ${input.agent}: ${input.note}`,
  );
  await d.deps.tasks.write(task);
  let note = input.note;
  if (input.kind === 'conflicts') {
    d.deps.log(`Merging ${base} into ${branch}…`);
    const merge = await git.mergeRef(path, `origin/${base}`);
    if (merge.clean) {
      // Nothing for an agent: the merge adds only the base's own reviewed commits. When the checks
      // pass, the factory approves and pushes it to the same PR; a failed check stops as usual.
      d.deps.log('The merge applied without conflicts. Verifying…');
      const gated = await d.gateAfterFollowUp(project, id);
      if (gated.stage !== 'awaiting-approval' || !gated.verification?.passed) return gated;
      await d.approve(project, id, {
        head: gated.verification.head_sha,
        note: `Approved by the factory: only origin/${base} was merged in, with no conflicts, and the checks passed.`,
      });
      return openPr(d.deps, project, id, {});
    }
    note = `${input.note}\n\nConflicted files:\n${merge.conflicted.map((f) => `- ${f}`).join('\n')}`;
  }
  const done = await d.agentRun(project, id, note);
  return followUpPushesItself(input.kind) ? d.pushReviewFix(project, id, done) : done;
}

/**
 * Merges `origin/<base>` into the task branch when the branch is behind it: a clean merge is
 * committed, a conflicted one is left for the agent with its files. Skipped when the worktree has
 * uncommitted work or a merge in progress, or the git port cannot fetch and merge.
 */
export async function syncBase(
  d: Driver,
  task: TaskRecord,
): Promise<{ merged: boolean; conflicted: string[] }> {
  const { git } = d.deps;
  const none = { merged: false, conflicted: [] };
  if (!git.fetchRefs || !git.mergeRef || !task.worktree) return none;
  const { path, base, branch } = await d.checkedWorktree(task);
  if (!(await git.isClean(path)) || (await git.mergeInProgress?.(path))) return none;
  try {
    await git.fetchRefs(path, [base]);
  } catch (error) {
    d.deps.log(`Could not fetch origin/${base}; the branch is not synced: ${(error as Error).message}`);
    return none;
  }
  const before = await git.headSha(path);
  const merge = await git.mergeRef(path, `origin/${base}`);
  if (!merge.clean) {
    d.deps.log(`Merged origin/${base} into ${branch}: conflicts in ${merge.conflicted.join(', ')}`);
    return { merged: true, conflicted: merge.conflicted };
  }
  const merged = (await git.headSha(path)) !== before;
  if (merged) d.deps.log(`Merged origin/${base} into ${branch} before the turn.`);
  return { merged, conflicted: [] };
}

/**
 * A review fix that passed the checks is approved by the review loop and pushed to the same PR.
 * Anything else (a failed check, a question, no change) stays where the run left it.
 */
export async function pushReviewFix(
  d: Driver,
  project: string,
  id: string,
  task: TaskRecord,
): Promise<TaskRecord> {
  if (task.stage !== 'awaiting-approval' || !task.verification?.passed) return task;
  await d.approve(project, id, {
    head: task.verification.head_sha,
    note: 'Approved by the review loop: the checks passed. Review the PR on GitHub.',
  });
  return openPr(d.deps, project, id, {});
}

/** Verifies the worktree head and puts a follow-up's commit at the approval gate. */
export async function gateAfterFollowUp(d: Driver, project: string, id: string): Promise<TaskRecord> {
  const verified = await d.verifyAndRecord(project, id);
  if (!verified.verification?.passed) return verified;
  const ready = withStage(verified, d.deps.now(), 'awaiting-approval', 'Ready for your review');
  await d.deps.tasks.write(ready);
  return ready;
}

/**
 * A workspace agent works the task in one session under the coder's guard and sandbox, then the
 * driver commits and verifies. A reply resumes the same session. There is no reviewer step: the
 * person reviews the change before approving it, and only a person opens the pull request.
 */
export async function agentRun(
  d: Driver,
  project: string,
  id: string,
  reply?: string,
  /** Fix turns still left in this run; below AGENT_FIX_TURNS, `reply` is Factory's own fix message. */
  fixTurns = AGENT_FIX_TURNS,
): Promise<TaskRecord> {
  if (!d.deps.agentSession) throw new DriverError('Agent runs are not available here.');
  const fromFactory = fixTurns < AGENT_FIX_TURNS;
  try {
    await d.preflight(project, id);
    let task = await d.deps.tasks.read(project, id);
    task = task.worktree ? await d.setupWorktree(project, id) : await d.prepareWorktree(project, id);
    const profile = await d.deps.readProfile(project);
    const { path, branch, compare } = await d.checkedWorktree(task);
    // The factory, not the agent, brings the base in: outside the sandbox, before the turn.
    const synced = await d.syncBase(task);
    if (synced.conflicted.length)
      reply = [
        `The factory merged the base branch into this branch before your turn and stopped on conflicts in:`,
        ...synced.conflicted.map((f) => `- ${f}`),
        'Resolve every conflict first so both changes keep working, and remove all conflict markers. Then continue:',
        reply ?? 'Continue the task.',
      ].join('\n');
    const session = await d.deps.agentSession(task, reply, fromFactory ? 'factory' : undefined);
    const spent = workSpend(task);
    const left = session.budgetUsd - spent;
    if (left <= 0) {
      const work = task.follow_ups?.length ? 'this follow-up' : 'this task';
      const message = `${session.name} spent the budget for ${work} ($${spent.toFixed(2)} of $${session.budgetUsd.toFixed(2)}). Raise ${session.name}'s budget per task in the agent's settings, then reply here to continue.`;
      await d.deps.tasks.write(withStage(task, d.deps.now(), 'blocked', message));
      return await d.deps.tasks.read(project, id);
    }
    task = withStage(
      task,
      d.deps.now(),
      'coding',
      fromFactory
        ? `${session.name} works on the verification failure`
        : reply
          ? `${session.name} read your reply`
          : `${session.name} started`,
    );
    await d.deps.tasks.write(task);

    const sandbox = {
      allowed_domains: profile.sandbox?.allowed_domains,
      allow_write: profile.sandbox?.allow_write,
    };
    const guard = d.coderGuard(path, profile, task);
    const access = await d.coderAccess(project, id, task.repo, profile);
    const limits = {
      signal: d.deps.signal,
      timeoutMs: 120 * MINUTE,
      stallMs: DEFAULT_STEP_LIMITS.stall_minutes * MINUTE,
      maxBudgetUsd: Math.max(0.01, left),
    };
    const grant = d.deps.delegation?.grant({
      label: `agent ${project}/${id}`,
      cwd: path,
      access: 'edit',
      sandbox,
      budgetUsd: Math.min(left, DEFAULT_STEP_LIMITS.budget_usd),
      guard,
      runner: d.deps.runner,
      tools: [
        ...session.tools,
        changeCheckTool(async () => {
          const current = await d.deps.tasks.read(project, id);
          return changeGate(d.deps, path, compare, current.allow_test_changes === true);
        }),
      ],
      ...(limits.signal ? { signal: limits.signal } : {}),
    });
    const passEnv = [...(profile.sandbox?.pass_env ?? []), ...session.passEnv];
    const started = d.deps.now();
    let outcome: StepAttempt['outcome'] = 'completed';
    let error: string | undefined;
    let costUsd: number | null = null;
    let sessionId = task.agent_session;
    // The agent's last message: what it says it did, for the PR writer.
    let report = '';
    let saving: Promise<void> = Promise.resolve();
    try {
      const result = await d.deps.runner.run({
        ...limits,
        step: 'agent',
        sandbox,
        ...(access.env ? { env: access.env } : {}),
        ...(passEnv.length ? { passEnv } : {}),
        model: session.model,
        effort: session.effort,
        tools: 'edit',
        cwd: path,
        ...(await d.agentExtras(project, session.model, session.systemPrompt)),
        prompt: session.prompt,
        guard,
        maxTurns: 300,
        persistSession: true,
        ...(task.agent_session ? { resume: task.agent_session } : {}),
        ...(grant ? { mcp: grant.endpoint } : {}),
        // Save the session as soon as it exists: a stopped or crashed call must still resume it,
        // or the next reply starts an agent that remembers nothing of its own work.
        onEvent: (event) => {
          if (event.type !== 'session' || event.id === sessionId) return;
          sessionId = event.id;
          saving = saving.then(async () => {
            const current = await d.deps.tasks.read(project, id);
            await d.deps.tasks.write({ ...current, agent_session: event.id });
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
      grant?.revoke();
      await access.cleanup();
      await saving.catch(() => undefined);
    }
    const childCost = grant?.spent() ?? 0;
    if (childCost) costUsd = (costUsd ?? 0) + childCost;

    let committed = false;
    // A conflict follow-up leaves a merge in progress: the commit below completes it.
    const merging = (await d.deps.git.mergeInProgress?.(path)) ?? false;
    if (outcome === 'completed') {
      const changed = await d.deps.git.stageAll(path);
      const forbidden = protectedPaths(
        changed,
        profile.confirmed.forbidden_paths,
        task.allow_protected_paths === true,
      );
      const marked = merging ? await conflictMarkers(path, changed) : [];
      if (forbidden.length) {
        await d.deps.git.unstageAll(path);
        outcome = 'failed';
        error = `${session.name} changed forbidden paths: ${forbidden.join(', ')}`;
      } else if (marked.length) {
        outcome = 'failed';
        error = `conflict markers remain in ${marked.join(', ')}`;
      } else if (changed.length || merging) {
        await d.deps.git.commit(path, `${taskTitle(task)}\n\nFactory task ${task.id} (${session.name}).`);
        committed = true;
      }
    }

    task = await d.deps.tasks.read(project, id);
    const attempt: StepAttempt = {
      step: 'agent',
      rung: session.name,
      model: session.model,
      effort: session.effort,
      started_at: started,
      finished_at: d.deps.now(),
      outcome,
      cost_usd: costUsd,
      ...(error ? { error } : {}),
    };
    task = withEvent(
      {
        ...task,
        attempts: [...(task.attempts ?? []), attempt],
        ...(sessionId ? { agent_session: sessionId } : {}),
      },
      d.deps.now(),
      'attempt',
      `${session.name} ${outcome === 'failed' ? `stopped: ${error}` : 'finished'}${committed ? ` and Factory committed the rest on ${branch}` : ''}`,
    );
    if (outcome === 'failed') {
      if (merging) await d.deps.git.abortMerge?.(path);
      await d.deps.tasks.write(withStage(task, d.deps.now(), 'failed', error ?? `${session.name} failed`));
      throw new DriverError(error ?? 'agent failed');
    }
    const base = task.worktree?.base_branch ?? profile.repo.base_branch.value;
    const asked = session.reported();
    // A follow-up that changed nothing leaves the PR as it was: the task is done again.
    if (task.pr && asked !== 'blocked' && (await d.deps.git.headSha(path)) === task.pr.head_sha) {
      await d.deps.tasks.write(
        withStage(
          task,
          d.deps.now(),
          'pr-opened',
          `${session.name} made no changes; the pull request is unchanged.`,
        ),
      );
      return await d.deps.tasks.read(project, id);
    }
    if (asked === 'blocked' || (await d.deps.git.commitCountSince(path, base)) === 0) {
      const message =
        asked === 'blocked'
          ? `${session.name} needs you. Reply on the task to continue.`
          : `${session.name} made no changes. Reply on the task to continue.`;
      await d.deps.tasks.write(withStage(task, d.deps.now(), 'blocked', message));
      return await d.deps.tasks.read(project, id);
    }
    await d.deps.tasks.write(task);
    d.deps.log('Verifying…');
    const checked = await d.verifyAndRecord(project, id);
    if (!checked.verification?.passed) {
      // An agent can fix most failures itself: it gets the failure in the same session.
      const steer =
        fixTurns > 0
          ? verificationSteer(checked.verification?.output_tail ?? '', profile.environment_errors)
          : undefined;
      if (!steer) return checked;
      const turn = AGENT_FIX_TURNS - fixTurns + 1;
      await d.deps.tasks.write(
        withEvent(
          checked,
          d.deps.now(),
          'verification',
          `Verification failed; ${session.name} gets fix turn ${turn} of ${AGENT_FIX_TURNS}.`,
        ),
      );
      return await d.agentRun(project, id, steer, fixTurns - 1);
    }
    // The PR text is written now, so you read it at the gate; a failure leaves the template fallback.
    const verified = await d.draftPrQuietly(project, id, { agentReport: report });
    const ready = withStage(
      verified,
      d.deps.now(),
      'awaiting-approval',
      `${session.name}'s change is ready for your review`,
    );
    await d.deps.tasks.write(ready);
    return ready;
  } catch (error) {
    const current = await d.deps.tasks.read(project, id);
    if (!['failed', 'verification-failed', 'blocked', 'awaiting-approval'].includes(current.stage))
      await d.deps.tasks.write(
        withStage(current, d.deps.now(), 'failed', error instanceof Error ? error.message : String(error)),
      );
    throw error;
  }
}
