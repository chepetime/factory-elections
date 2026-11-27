// Executes one accepted task run: its model calls, driver steps, session log and run record. It
// holds what is live about each run (abort controller, activity, session) for the service to read.
import { dirname, join } from 'node:path';
import {
  combineCleanup,
  Conflict,
  errorCleanup,
  failureOutcome,
  modelRefused,
  parseModelRef,
  runWorking,
  taskClass,
  withSession,
  withStage,
  withUserRules,
  type AgentEvent,
  type CallCleanup,
  type CallManifest,
  type ModelFailure,
  type ModelResult,
  type ModelRunner,
  type ProviderSessionRef,
  type TaskRecord,
  type UserSettings,
} from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';
import type { Driver } from '@factory/driver';
import type { Release } from '@factory/dispatcher';
import { callManifest, Evidence, withManifest, type TraceLog } from '@factory/evidence';
import { SessionLog, transcriptEntries, type MemoryService, type SessionEntry } from '@factory/agents';
import type { ActivitySnapshot } from '@factory/backend-client/protocol';
import { RunActivity, trackShell } from './activity.ts';
import type { RunCommand, RunRecord } from './run-record.ts';
import type { TaskTraces } from './task-traces.ts';

/** Runs one command on the driver and says what it did. */
export async function performCommand(command: RunCommand, driver: Driver): Promise<string> {
  const { project, id, action } = command;
  switch (action) {
    case 'run':
      return (
        await driver.run(project, id, {
          maxAttempts: command.max_attempts || 3,
          ...(command.note ? { reply: command.note } : {}),
        })
      ).stage;
    case 'check':
      return (await driver.check(project, id)).stage;
    case 'revise':
      return (await driver.revise(project, id, command.note, { maxAttempts: command.max_attempts || 3 }))
        .stage;
    case 'approve':
      return `Approved: ${(await driver.approve(project, id, { head: command.head, note: command.note || undefined, acceptBlocking: command.accept_blocking })).approval!.head_sha}`;
    case 'reject':
      await driver.reject(project, id, command.note);
      return `Rejected: ${id}`;
    case 'open-pr':
      return (await driver.openPr(project, id, { draft: command.draft })).pr!.url;
    case 'follow-up':
      return (
        await driver.followUp(project, id, {
          note: command.note,
          kind: command.kind || 'custom',
          agent: command.agent,
          by: command.by || 'you',
          ...(command.pr_head ? { prHead: command.pr_head } : {}),
        })
      ).stage;
  }
}

export interface RunExecutorDeps {
  storage: DataStorage;
  tasks: {
    read(project: string, id: string): Promise<TaskRecord>;
    write(task: TaskRecord): Promise<unknown>;
    taskPath(project: string, id: string): string;
  };
  traces: TraceLog;
  taskTraces: TaskTraces;
  memory: Pick<MemoryService, 'recording'>;
  user: { get(): Promise<UserSettings> };
  /** The model runner for a run; `log` receives its progress lines. */
  runner(log: (line: string) => void): ModelRunner;
  driver(log: (line: string) => void, runner: ModelRunner, signal: AbortSignal): Driver;
  /** Whether a person asked to stop the run. */
  stopRequested(runId: string): boolean;
  /** Saves the task's evidence receipt. */
  receipt(project: string, id: string): Promise<unknown>;
  /** A slot is free again: an agent may take its next Todo task. */
  kick(): void;
}

export class RunExecutor {
  private readonly deps: RunExecutorDeps;
  /** Aborts each running run's model calls and checks. */
  private readonly controllers = new Map<string, AbortController>();
  /** What each executing run is doing now: current command and last output. */
  private readonly activities = new Map<string, RunActivity>();
  constructor(deps: RunExecutorDeps) {
    this.deps = deps;
  }

  /** Whether the run started executing (it holds an abort controller). */
  started(runId: string): boolean {
    return this.controllers.has(runId);
  }
  /** Stops an executing run's model calls and checks. False when it has not started. */
  abort(runId: string): boolean {
    const controller = this.controllers.get(runId);
    controller?.abort();
    return !!controller;
  }
  abortAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }
  /** What an executing run is doing now; undefined when it is not executing. */
  activity(runId: string): ActivitySnapshot | undefined {
    return this.activities.get(runId)?.snapshot();
  }
  /** A task's session: every agent message, tool call and result of its runs, live while one works. */
  async session(project: string, id: string): Promise<{ entries: SessionEntry[]; live: boolean }> {
    const live = this.sessionLogs.get(`${project}/${id}`);
    return live
      ? { entries: live.entries, live: true }
      : { entries: await this.readSession(project, id), live: false };
  }

  /** Session logs of runs in progress, per `project/task id`. */
  private readonly sessionLogs = new Map<string, SessionLog>();
  private sessionPath(project: string, id: string): string {
    return join(dirname(this.deps.tasks.taskPath(project, id)), 'session.json');
  }
  private async readSession(project: string, id: string): Promise<SessionEntry[]> {
    const doc = (await this.deps.storage
      .readDocument(this.sessionPath(project, id))
      .catch(() => undefined)) as { entries?: SessionEntry[] } | undefined;
    if (Array.isArray(doc?.entries)) return doc.entries;
    // Runs from before session logs: rebuild the agent's session from Claude's transcripts.
    const task = await this.deps.tasks.read(project, id).catch(() => undefined);
    return task?.workflow === 'agent' && task.worktree ? transcriptEntries(task.worktree.path) : [];
  }
  /**
   * Runs an accepted command that holds its worker, agent and pool slot, and writes its record.
   * `release` frees the slots once the agent is done, before the record is written.
   */
  async run(command: RunCommand, record: RunRecord, dir: string, release: Release): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(record.id, controller);
    if (this.deps.stopRequested(record.id)) controller.abort();
    const activity = new RunActivity();
    this.activities.set(record.id, activity);
    let evidence: Evidence | undefined;
    // Cleanup evidence and session references from the run's model calls (ADR 0005).
    const calls: CallCleanup[] = [];
    let sessions: ProviderSessionRef[] = [];
    let manifests: CallManifest[] = [];
    const trace = await this.deps.taskTraces.start(command.project, command.id).catch(() => undefined);
    const sessionKey = `${command.project}/${command.id}`;
    // A read failure here would skip the finally below and leak this run's slots: start empty.
    const session = new SessionLog(await this.readSession(command.project, command.id).catch(() => []));
    session.run(command.action === 'revise' && command.note ? `You replied: ${command.note}` : record.label);
    this.sessionLogs.set(sessionKey, session);
    let savedAt = Date.now();
    const saveSession = () =>
      this.deps.storage
        .writeDocument(this.sessionPath(command.project, command.id), { entries: session.entries })
        .catch(() => undefined);
    try {
      evidence = new Evidence(join(dir, 'events.jsonl'), record.id, this.deps.storage);
      record.state = 'running';
      await this.deps.storage.writeDocument(join(dir, 'run.json'), record);
      const sink = evidence;
      let logFailure: unknown;
      const log = (message: string) => {
        activity.heard();
        try {
          sink.log(message, { project: command.project, task_id: command.id });
        } catch (error) {
          // Log callbacks may run inside child-process data events: fail at an async boundary.
          logFailure ??= error;
        }
      };
      await sink.span(
        `task.${command.action}`,
        { project: command.project, task_id: command.id },
        async (span) => {
          const base = this.deps.runner(log);
          const ledger = trace ? this.deps.traces.runner(base, () => trace.scope) : base;
          const traced = this.deps.memory.recording(command.project, record.id, sink.runner(ledger, span));
          // Read once per run: a change in user settings applies from the next run.
          const user = await this.deps.user.get();
          const checked: ModelRunner = {
            async run(original) {
              if (logFailure) throw logFailure;
              const refused = modelRefused(user, original.model);
              if (refused) throw new Conflict(`${refused}. Turn it on at /user, or pick another model.`);
              const request = {
                ...original,
                systemPrompt: withUserRules(original.systemPrompt, user),
                onEvent: (event: AgentEvent) => {
                  session.event(event, original.step);
                  // Saved now and then, so a crash loses little of what the person could read.
                  if (Date.now() - savedAt > 15_000) {
                    savedAt = Date.now();
                    void saveSession();
                  }
                  original.onEvent?.(event);
                },
              };
              manifests = withManifest(manifests, callManifest(request));
              let result: ModelResult;
              try {
                result = await traced.run(request);
              } catch (error) {
                const cleanup = errorCleanup(error);
                if (cleanup) calls.push(cleanup);
                throw error;
              }
              if (result.sessionId)
                sessions = withSession(sessions, {
                  provider: parseModelRef(request.model).provider,
                  native_id: result.sessionId,
                  ...(request.cwd ? { cwd: request.cwd } : {}),
                  scope: request.persistSession || request.resume ? 'task' : 'disposable',
                  ...(request.step ? { step: request.step } : {}),
                  last_used_at: new Date().toISOString(),
                });
              // Later spans of the run carry the class the classifier just gave the task.
              if (trace && request.step === 'classifier')
                trace.scope.task_class =
                  taskClass(result.structured as { kind?: string; loe?: string }) ?? trace.scope.task_class;
              return result;
            },
          };
          const driver = this.deps.driver(log, checked, controller.signal);
          driver.deps.shell = trackShell(driver.deps.shell, activity);
          await performCommand(command, driver);
          if (logFailure) throw logFailure;
        },
      );
      record.state = 'completed';
      record.outcome = 'completed';
    } catch (error) {
      record.state = 'failed';
      const stopped = this.deps.stopRequested(record.id);
      record.outcome = failureOutcome((error as { kind?: ModelFailure } | null)?.kind, stopped);
      record.error = stopped
        ? 'Stopped by you before the run finished.'
        : error instanceof Error
          ? error.message
          : String(error);
      // A worker error must not leave the UI thinking an owned run is still coding.
      const task = await this.deps.tasks.read(command.project, command.id);
      if (stopped || runWorking(task.stage))
        await this.deps.tasks.write(withStage(task, new Date().toISOString(), 'failed', record.error));
    } finally {
      this.controllers.delete(record.id);
      this.activities.delete(record.id);
      await saveSession();
      this.sessionLogs.delete(sessionKey);
      // The agent is done: its slots go to the next waiting run while this one writes its records.
      release();
      // A slot is free again: an agent may take its next Todo task.
      this.deps.kick();
      record.finished_at = new Date().toISOString();
      record.cleanup = combineCleanup(calls);
      if (sessions.length) record.provider_sessions = sessions;
      if (manifests.length) record.manifests = manifests;
      if (trace) await this.deps.taskTraces.end(trace, command.action, record).catch(() => undefined);
      try {
        try {
          await this.deps.storage.writeDocument(join(dir, 'run.json'), record);
          // The receipt reads this run's manifests, so it follows the run record.
          await this.deps.receipt(command.project, command.id).catch(() => undefined);
        } finally {
          await evidence?.close();
        }
      } catch (error) {
        // Evidence durability is part of completion, even if the workflow itself succeeded.
        record.state = 'failed';
        record.outcome = 'failed';
        record.error = [
          record.error,
          `Run finalization failed: ${error instanceof Error ? error.message : String(error)}`,
        ]
          .filter(Boolean)
          .join('\n');
        await this.deps.storage.writeDocument(join(dir, 'run.json'), record);
      }
    }
  }
}
