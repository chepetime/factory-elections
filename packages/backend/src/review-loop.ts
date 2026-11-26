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
  type ReviewPayload,
  type TaskRecord,
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
  /** Adds a line to the task's activity. */
  note(project: string, taskId: string, message: string): Promise<unknown>;
  /** The PR description for the task's current commit, in the repository's template. */
  body(task: TaskRecord): Promise<string>;
  github: {
    markReady(cwd: string, number: number): Promise<void>;
    /** Whether the PR is still a draft on GitHub. */
    isDraft(cwd: string, number: number): Promise<boolean>;
    editBody(cwd: string, number: number, body: string): Promise<void>;
  };
  now?: () => string;
  log?: (line: string) => void;
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
        history: same?.history ?? [],
        updated_at: this.now(),
      };
      await this.save(task, state);
      await this.review(task, state, number);
    });
  }

  /** A senior-pr-review ended: send the important findings back, or finish the loop. */
  async reviewEnded(project: string, number: number, payload: ReviewPayload | undefined): Promise<void> {
    const task = (await this.deps.tasks.list(project)).find((t) => prNumber(t) === number);
    if (!task) return;
    await this.serial(task, async () => {
      const state = await this.state(task);
      if (!state || state.pr !== number || state.state !== 'reviewing') return;
      if (!payload) return this.stop(task, state, 'The senior PR review stopped without a result.');
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
        await this.deps.note(
          project,
          task.id,
          `Review round ${state.round}: ${important.length} critical or must-fix ${important.length === 1 ? 'finding' : 'findings'} sent back to the agent.`,
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
      await this.finish(task, { ...state, notes: reviewNotes([...important, ...rest]), history });
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
      if (wasDraft) await this.deps.github.markReady(current.worktree.path, state.pr);
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
