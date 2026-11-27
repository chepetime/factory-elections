// The review loop for agent PRs (rules in core review-loop.ts). A draft PR that an agent opened gets
// a senior-pr-review. Critical and must-fix findings go back to the agent as a `review` follow-up,
// whose fix is pushed once the checks pass; then the PR is reviewed again. When nothing important
// is left, or after the last fix round, the PR leaves draft with the remaining findings listed.
// State lives in `tasks/<id>/review-loop.json`, apart from the task record the runs write.
import { dirname, join } from 'node:path';
import {
  REVIEW_LOOP_MAX_FIXES,
  ReviewLoopState,
  reviewFixNote,
  reviewNotes,
  reviewNotesSection,
  splitFindings,
  severityCounts,
  type PrState,
  type ReviewOutcome,
  type ReviewPayload,
  type TaskRecord,
  type TendingWaiting,
} from '@factory/core';

export interface ReviewLoopDeps {
  tasks: {
    list(project: string): Promise<TaskRecord[]>;
    read(project: string, id: string): Promise<TaskRecord>;
    taskPath(project: string, id: string): string;
  };
  storage: {
    readDocument(path: string): Promise<unknown>;
    writeDocument(path: string, data: unknown): Promise<void>;
  };
  /** Starts a fresh senior-pr-review of the PR. */
  startReview(project: string, number: number): Promise<void>;
  /** Queues a `review` follow-up with these instructions for the task's agent. */
  followUp(project: string, taskId: string, note: string): Promise<unknown>;
  /** Adds a line to the task's activity; with `review`, the feed shows it as an outcome card. */
  note(project: string, taskId: string, message: string, review?: ReviewOutcome): Promise<unknown>;
  /** The PR description for the task's current commit, in the repository's template. */
  body(task: TaskRecord): Promise<string>;
  github: {
    markReady(cwd: string, number: number): Promise<void>;
    /** Whether the PR is still a draft on GitHub. */
    isDraft(cwd: string, number: number): Promise<boolean>;
    editBody(cwd: string, number: number, body: string): Promise<void>;
  };
  /**
   * Whether the PR may leave draft: checks settled green and it merges cleanly. Absent: always
   * ready. `reason` says what holds it back (pending, failing, conflict).
   */
  readiness?(cwd: string, number: number): Promise<{ ok: true } | { ok: false; reason: string }>;
  now?: () => string;
  log?: (line: string) => void;
}

/** Whether a PR may leave draft: checks settled green and it merges cleanly. */
export function prReadiness(pr: PrState): { ok: true } | { ok: false; reason: string } {
  if (pr.mergeable === 'CONFLICTING') return { ok: false, reason: 'it conflicts with its base' };
  const failed = pr.checks.filter((c) => c.state === 'fail');
  if (failed.length)
    return { ok: false, reason: `checks are failing: ${failed.map((c) => c.name).join(', ')}` };
  if (pr.checks.some((c) => c.state !== 'pass' && c.state !== 'skipped'))
    return { ok: false, reason: 'checks are still pending' };
  return pr.mergeable === 'MERGEABLE'
    ? { ok: true }
    : { ok: false, reason: 'GitHub has not settled whether it merges cleanly' };
}

const prNumber = (task: TaskRecord) => Number(/\/pull\/(\d+)/.exec(task.pr?.url ?? '')?.[1]) || undefined;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class ReviewLoop {
  private readonly deps: ReviewLoopDeps;
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(deps: ReviewLoopDeps) {
    this.deps = deps;
  }
  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private path(task: Pick<TaskRecord, 'project' | 'id'>): string {
    return join(dirname(this.deps.tasks.taskPath(task.project, task.id)), 'review-loop.json');
  }
  async state(task: Pick<TaskRecord, 'project' | 'id'>): Promise<ReviewLoopState | undefined> {
    const raw = await this.deps.storage.readDocument(this.path(task)).catch(() => undefined);
    const parsed = ReviewLoopState.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }
  private save(task: Pick<TaskRecord, 'project' | 'id'>, state: ReviewLoopState): Promise<void> {
    return this.deps.storage.writeDocument(this.path(task), { ...state, updated_at: this.now() });
  }

  /** Agent PRs whose review loop stopped and now wait on the human. */
  async waiting(project: string, tasks: readonly TaskRecord[]): Promise<TendingWaiting[]> {
    const out: TendingWaiting[] = [];
    for (const task of tasks) {
      const number = prNumber(task);
      if (task.project !== project || !number || !task.pr) continue;
      const state = await this.state(task);
      if (state?.state === 'stopped' && state.pr === number)
        out.push({
          task_id: task.id,
          number,
          url: task.pr.url,
          reason: state.reason ?? 'The review loop stopped.',
          since: state.updated_at,
        });
    }
    return out;
  }

  /** One step at a time per task: a review result and a run's end may arrive together. */
  private serial<T>(task: Pick<TaskRecord, 'project' | 'id'>, step: () => Promise<T>): Promise<T> {
    const key = `${task.project}/${task.id}`;
    const next = (this.queues.get(key) ?? Promise.resolve()).then(step);
    const tail = next.catch(() => undefined);
    this.queues.set(key, tail);
    void tail.then(() => this.queues.get(key) === tail && this.queues.delete(key));
    return next;
  }

  /**
   * The task's PR changed. `opened`: an agent's draft PR starts the loop; one opened ready for
   * review is left to people. `updated`: a follow-up you approved was pushed to the PR, so it is
   * reviewed again, whatever an earlier cycle ended with.
   */
  prChanged(
    task: TaskRecord,
    change: { kind: 'opened'; draft: boolean } | { kind: 'updated' },
  ): Promise<void> {
    return this.serial(task, async () => {
      const number = prNumber(task);
      if (task.workflow !== 'agent' || !number || task.stage !== 'pr-opened') return;
      if (change.kind === 'opened' && !change.draft) return;
      const prior = await this.state(task);
      const same = prior?.pr === number ? prior : undefined;
      if (change.kind === 'opened' && same) return;
      if (same && (same.state === 'reviewing' || same.state === 'fixing')) {
        // A fix is reviewed next anyway; a running review may have read the older commit.
        if (same.state === 'reviewing') await this.save(task, { ...same, recheck: true });
        await this.deps.note(
          task.project,
          task.id,
          `PR #${number} was updated while review cycle ${same.cycle} runs; the cycle reviews the new commit before it ends.`,
        );
        return;
      }
      const state: ReviewLoopState = {
        pr: number,
        state: 'reviewing',
        round: 1,
        fixes: 0,
        cycle: (same?.cycle ?? 0) + 1,
        recheck: false,
        notes: [],
        sent: [],
        resumed: 0,
        history: same?.history ?? [],
        updated_at: this.now(),
      };
      await this.save(task, state);
      await this.review(task, state, number);
    });
  }

  /** A senior-pr-review ended: send the important findings back, or finish the loop. */
  async reviewEnded(
    project: string,
    number: number,
    payload: ReviewPayload | undefined,
    reason?: string,
  ): Promise<void> {
    const task = (await this.deps.tasks.list(project)).find((t) => prNumber(t) === number);
    if (!task) return;
    await this.serial(task, async () => {
      const state = await this.state(task);
      if (!state || state.pr !== number || state.state !== 'reviewing') return;
      if (!payload)
        return this.stop(
          task,
          state,
          `The senior PR review ended without a report. ${reason ?? 'It saved no result.'}`,
        );
      const { important, rest } = splitFindings(payload.findings);
      const history = [
        ...state.history,
        {
          at: this.now(),
          round: state.round,
          decision: payload.meta.decision ?? '',
          sent: important.length,
          left: rest.length,
        },
      ];
      const outcome = (next: string): ReviewOutcome => ({
        source: 'self',
        pr: number,
        round: state.round,
        decision: payload.meta.decision?.trim() || 'No decision',
        ...(payload.meta.summary?.trim() ? { summary: payload.meta.summary.trim() } : {}),
        counts: severityCounts(payload.findings),
        next,
      });
      if (important.length && state.fixes < REVIEW_LOOP_MAX_FIXES) {
        const next: ReviewLoopState = {
          ...state,
          state: 'fixing',
          fixes: state.fixes + 1,
          notes: reviewNotes(rest),
          sent: reviewNotes(important),
          history,
          updated_at: this.now(),
        };
        await this.save(task, next);
        const sentBack = `${important.length} critical or must-fix ${important.length === 1 ? 'finding' : 'findings'} sent back to the agent.`;
        await this.deps.note(
          project,
          task.id,
          `Review round ${state.round}: ${sentBack}`,
          outcome(`${sentBack} Its fix is pushed once the checks pass, then reviewed again.`),
        );
        try {
          await this.deps.followUp(project, task.id, reviewFixNote(important, state.round));
        } catch (error) {
          await this.stop(task, next, `The fix follow-up could not start: ${message(error)}`);
        }
        return;
      }
      // The PR changed while this review ran: review the newest commit before the cycle ends.
      if (state.recheck) {
        await this.deps.note(
          project,
          task.id,
          `Review round ${state.round}: ${payload.meta.decision ?? 'done'}; the PR changed meanwhile.`,
          outcome('The PR changed during the review, so the newest commit is reviewed next.'),
        );
        const again: ReviewLoopState = {
          ...state,
          round: state.round + 1,
          recheck: false,
          history,
          updated_at: this.now(),
        };
        await this.save(task, again);
        return this.review(task, again, number);
      }
      // Clean, or out of fix rounds: what is left goes to the people with the PR.
      await this.deps.note(
        project,
        task.id,
        `Review round ${state.round}: ${payload.meta.decision ?? 'done'}.`,
        outcome(
          important.length
            ? `Out of fix rounds: the ${important.length} important ${important.length === 1 ? 'finding is' : 'findings are'} listed in the PR description for people.`
            : rest.length
              ? `Nothing critical or must-fix. The ${rest.length} other ${rest.length === 1 ? 'finding goes' : 'findings go'} into the PR description, and the PR is ready for review.`
              : 'Nothing to fix. The PR is ready for review.',
        ),
      );
      await this.finish(task, { ...state, notes: reviewNotes([...important, ...rest]), history });
    });
  }

  /**
   * The running review of the loop was interrupted (a backend restart cut its turn), so no result
   * will come. Start it again, at most twice per cycle; then stop and say why.
   */
  resumeInterrupted(task: TaskRecord): Promise<void> {
    return this.serial(task, async () => {
      const state = await this.state(task);
      const number = prNumber(task);
      if (!state || state.state !== 'reviewing' || !number || state.pr !== number) return;
      if (state.resumed >= 2)
        return this.stop(
          task,
          state,
          'The senior PR review was interrupted three times by backend restarts.',
        );
      const next: ReviewLoopState = { ...state, resumed: state.resumed + 1, updated_at: this.now() };
      await this.save(task, next);
      await this.deps.note(
        task.project,
        task.id,
        `Review round ${state.round} of #${number} was interrupted by a backend restart; it starts again.`,
      );
      await this.review(task, next, number);
    });
  }

  /** A run of the task ended. After a review fix: review again, or finish after the last round. */
  async runSettled(project: string, id: string): Promise<void> {
    const task = await this.deps.tasks.read(project, id).catch(() => undefined);
    if (!task) return;
    await this.serial(task, async () => {
      const state = await this.state(task);
      if (!state || state.state !== 'fixing') return;
      const current = await this.deps.tasks.read(project, id);
      if (current.stage !== 'pr-opened' || !current.pr)
        return this.stop(
          task,
          state,
          `The agent's fix stopped at ${current.stage}. The ticket shows what it needs; the PR stays a draft.`,
        );
      // Out of fix rounds: no review checks this last fix, so the PR says so.
      if (state.fixes >= REVIEW_LOOP_MAX_FIXES) return this.finish(current, state, state.sent);
      const next: ReviewLoopState = { ...state, state: 'reviewing', round: state.round + 1 };
      await this.save(task, next);
      await this.review(current, next, state.pr);
    });
  }

  /**
   * Tending saw the PR: a finished review that waited for CI hands the draft off once checks are
   * green and it merges cleanly; otherwise the reason is refreshed.
   */
  checksChanged(task: TaskRecord): Promise<void> {
    return this.serial(task, async () => {
      const state = await this.state(task);
      const number = prNumber(task);
      if (!state || state.state !== 'awaiting-ci' || state.pr !== number || !number) return;
      const current = await this.deps.tasks.read(task.project, task.id);
      if (!current.worktree || current.stage !== 'pr-opened' || !this.deps.readiness) return;
      const cwd = current.worktree.path;
      const ready = await this.deps.readiness(cwd, number);
      if (!ready.ok) {
        if (ready.reason !== state.reason)
          await this.save(task, { ...state, reason: ready.reason, updated_at: this.now() });
        return;
      }
      if (await this.deps.github.isDraft(cwd, number)) await this.deps.github.markReady(cwd, number);
      await this.save(task, { ...state, state: 'ready', reason: undefined, updated_at: this.now() });
      await this.deps.note(task.project, task.id, `PR #${number} is ready for review: checks are green.`);
    });
  }

  private async review(task: TaskRecord, state: ReviewLoopState, number: number): Promise<void> {
    try {
      await this.deps.startReview(task.project, number);
      await this.deps.note(
        task.project,
        task.id,
        `Review round ${state.round}: a senior PR review of #${number} started.`,
      );
    } catch (error) {
      await this.stop(task, state, `The senior PR review could not start: ${message(error)}`);
    }
  }

  private async finish(
    task: TaskRecord,
    state: ReviewLoopState,
    unreviewed: ReviewLoopState['notes'] = [],
  ): Promise<void> {
    const current = await this.deps.tasks.read(task.project, task.id);
    if (!current.worktree || !current.pr) return this.stop(task, state, 'The task has no worktree or PR.');
    let wasDraft = false;
    try {
      const body = await this.deps.body(current);
      const section = reviewNotesSection({ ...state, unreviewed });
      // Before the factory's record footer, so the notes read with the description.
      const footer = body.indexOf('\n---\n');
      const withNotes =
        footer >= 0
          ? `${body.slice(0, footer).trimEnd()}\n\n${section}\n${body.slice(footer)}`
          : `${body}\n\n${section}`;
      await this.deps.github.editBody(current.worktree.path, state.pr, withNotes);
      // A PR that people already review (an update after an earlier cycle) only gets new notes.
      wasDraft = await this.deps.github.isDraft(current.worktree.path, state.pr);
      if (wasDraft) {
        const ready = (await this.deps.readiness?.(current.worktree.path, state.pr)) ?? { ok: true as const };
        if (!ready.ok) {
          // Review is done, CI is not green: stay draft; tending marks it ready once it is.
          await this.save(task, {
            ...state,
            state: 'awaiting-ci',
            reason: ready.reason,
            updated_at: this.now(),
          });
          await this.deps.note(
            task.project,
            task.id,
            `PR #${state.pr} stays a draft: ${ready.reason}. Tending marks it ready once checks are green.`,
          );
          return;
        }
        await this.deps.github.markReady(current.worktree.path, state.pr);
      }
    } catch (error) {
      return this.stop(task, state, `The PR could not be marked ready: ${message(error)}`);
    }
    await this.save(task, { ...state, state: 'ready', updated_at: this.now() });
    const notes = state.notes.length
      ? `, with ${state.notes.length} review ${state.notes.length === 1 ? 'note' : 'notes'} for you`
      : '';
    await this.deps.note(
      task.project,
      task.id,
      wasDraft
        ? `PR #${state.pr} is ready for review${notes}.`
        : `PR #${state.pr} was reviewed again after the update${notes}; its description has the new notes.`,
    );
  }

  private async stop(task: TaskRecord, state: ReviewLoopState, reason: string): Promise<void> {
    await this.save(task, { ...state, state: 'stopped', reason, updated_at: this.now() });
    await this.deps.note(task.project, task.id, `Review loop stopped: ${reason}`).catch(() => undefined);
    this.deps.log?.(`review loop ${task.project}/${task.id}: ${reason}`);
  }
}
