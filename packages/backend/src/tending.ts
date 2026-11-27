// PR tending: every 10 minutes, for projects that turn it on, keep each open factory PR moving.
// It reruns failed checks once per commit, fixes failing CI, merges the base in on conflicts, and
// (with `answer_threads`) answers review threads. It pushes only fast-forward commits on the PR's
// own branch: never a force-push, never a merge of the PR. A fix is pushed only after the
// profile's test command passes. After MAX_TEND_FIXES fixes without a green PR, tending stops and
// the PR goes to the inbox.
import { dirname, join } from 'node:path';
import { stat } from 'node:fs/promises';
import {
  DEFAULT_TASK_LIMITS,
  answeredKey,
  isGreen,
  nextTendAction,
  PrState,
  rollupChecks,
  TEND_EVERY_MS,
  TEND_REPLIES_SCHEMA,
  TendRecord,
  TendReplies,
  type ModelRunner,
  type PrThread,
  type ProjectSettings,
  type RepoProfile,
  type TaskRecord,
  type TendAction,
  type TendFix,
  type TendingWaiting,
  conflictFollowUpSeen,
  PrStatus,
  protectedPaths,
} from '@factory/core';
import { NO_HOOKS, changedPathsSince } from '@factory/adapters-git';
import { setupInputsKey, worktreeGuard } from '@factory/driver';
import { run, runShell } from '@factory/adapters-process';

export interface TendingGitHub {
  me(): Promise<string>;
  pr(cwd: string, number: number): Promise<PrState>;
  /** State and draft flag only: one cheap call per PR per pass. */
  status(cwd: string, number: number): Promise<PrStatus>;
  rerunFailed(cwd: string, runId: string): Promise<void>;
  failedLog(cwd: string, runId: string): Promise<string>;
  reply(cwd: string, threadId: string, body: string): Promise<void>;
  resolve(cwd: string, threadId: string): Promise<void>;
}

export interface TendingDeps {
  projects: { list(): Promise<{ name: string }[]> };
  tasks: { list(project: string): Promise<TaskRecord[]>; taskPath(project: string, id: string): string };
  settings(project: string): Promise<ProjectSettings>;
  profile(project: string): Promise<RepoProfile>;
  /** A traced runner for one task's tending calls. */
  runner(task: TaskRecord): ModelRunner;
  /** Takes an agent slot at once, or returns undefined when every slot is in use. */
  slot(): Promise<(() => void) | undefined>;
  storage: {
    readDocument(path: string): Promise<unknown>;
    writeDocument(path: string, data: unknown): Promise<void>;
  };
  github?: TendingGitHub;
  /**
   * Every pass reads each open-PR task's PR once and reports it: the board moves a merged task to
   * Done, and an agent's draft PR without a review loop gets one.
   */
  prObserved?(task: TaskRecord, pr: PrStatus): Promise<unknown>;
  /**
   * Adds a conflict follow-up for the task's agent. Called when tending is off for the project and
   * the PR conflicts with its base, once per PR head.
   */
  conflictFollowUp?(task: TaskRecord, pr: { head_sha: string; base: string }): Promise<unknown>;
  log?(line: string): void;
}

export const TEND_MODEL = 'claude-sonnet-5-5';
const TEND_BUDGET_USD = 3;
const TEND_TIMEOUT_MS = 30 * 60_000;
const TEST_TIMEOUT_MS = 20 * 60_000;

const THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(last:20){nodes{id body author{login}}}}}}}}`;

async function gh(cwd: string, args: string[]): Promise<string> {
  const result = await run('gh', args, { cwd, timeoutMs: 60_000 });
  if (result.code !== 0) throw new Error(`gh ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

/** The `gh` CLI, as the machine's signed-in account. */
export const ghTending: TendingGitHub = {
  me: async () => (await gh(process.cwd(), ['api', 'user', '--jq', '.login'])).trim(),
  async pr(cwd, number) {
    const view = JSON.parse(
      await gh(cwd, [
        'pr',
        'view',
        String(number),
        '--json',
        'number,url,state,headRefOid,baseRefName,mergeable,statusCheckRollup',
      ]),
    ) as Record<string, unknown>;
    const threads = JSON.parse(
      await gh(cwd, [
        'api',
        'graphql',
        '-F',
        'owner={owner}',
        '-F',
        'name={repo}',
        '-F',
        `number=${number}`,
        '-f',
        `query=${THREADS_QUERY}`,
      ]),
    ) as { data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: Record<string, any>[] } } } } };
    return PrState.parse({
      number: view.number,
      url: view.url,
      state: view.state,
      head_sha: view.headRefOid,
      base: view.baseRefName,
      mergeable: view.mergeable,
      checks: rollupChecks((view.statusCheckRollup as Record<string, unknown>[]) ?? []),
      threads: (threads.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []).map((t) => ({
        id: t.id,
        resolved: t.isResolved,
        outdated: t.isOutdated,
        path: t.path ?? undefined,
        line: t.line ?? null,
        comments: (t.comments?.nodes ?? []).map((c: Record<string, any>) => ({
          id: c.id,
          author: c.author?.login ?? 'ghost',
          body: c.body ?? '',
        })),
      })),
    });
  },
  async status(cwd, number) {
    const view = JSON.parse(
      await gh(cwd, ['pr', 'view', String(number), '--json', 'number,state,isDraft']),
    ) as { number: number; state: string; isDraft: boolean };
    return PrStatus.parse({ number: view.number, state: view.state, draft: view.isDraft });
  },
  async rerunFailed(cwd, runId) {
    await gh(cwd, ['run', 'rerun', runId, '--failed']);
  },
  async failedLog(cwd, runId) {
    const out = await gh(cwd, ['run', 'view', runId, '--log-failed']).catch((e: unknown) => String(e));
    return out.slice(-6000);
  },
  async reply(cwd, threadId, body) {
    await gh(cwd, [
      'api',
      'graphql',
      '-f',
      `id=${threadId}`,
      '-f',
      `body=${body}`,
      '-f',
      'query=mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}',
    ]);
  },
  async resolve(cwd, threadId) {
    await gh(cwd, [
      'api',
      'graphql',
      '-f',
      `id=${threadId}`,
      '-f',
      'query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}',
    ]);
  },
};

async function git(cwd: string, args: string[]) {
  // No repository hooks: `merge` and `commit` would run the PR's own hooks on the host.
  return run('git', [...NO_HOOKS, ...args], { cwd, timeoutMs: 120_000 });
}
async function gitOk(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

const SYSTEM = [
  'You tend an open pull request that the factory opened. Make the smallest change that does the job.',
  'Work only in the current directory. Do not commit, push, switch branches or post anything: the factory does that after its checks pass.',
  'Keep the intent of the original change. Do not disable, skip or delete tests to make checks pass.',
].join('\n');

export class TendingService {
  private readonly deps: TendingDeps;
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private readonly busy = new Set<string>();
  constructor(deps: TendingDeps) {
    this.deps = deps;
  }
  private get github(): TendingGitHub {
    return this.deps.github ?? ghTending;
  }
  private path(task: TaskRecord): string {
    return join(dirname(this.deps.tasks.taskPath(task.project, task.id)), 'tending.json');
  }
  async record(task: TaskRecord): Promise<TendRecord | undefined> {
    try {
      return TendRecord.parse(await this.deps.storage.readDocument(this.path(task)));
    } catch {
      return undefined;
    }
  }
  private async save(task: TaskRecord, record: TendRecord): Promise<void> {
    await this.deps.storage.writeDocument(this.path(task), record);
  }

  startTicking(everyMs = TEND_EVERY_MS): void {
    this.timer ??= setInterval(() => void this.tick().catch(() => undefined), everyMs);
    this.timer.unref();
  }
  stopTicking(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass over every tended project. Overlapping passes share one run. */
  tick(): Promise<void> {
    return (this.ticking ??= this.pass().finally(() => (this.ticking = undefined)));
  }
  private async pass(): Promise<void> {
    for (const { name } of await this.deps.projects.list()) {
      const settings = await this.deps.settings(name).catch(() => undefined);
      if (!settings) continue;
      for (const task of await this.deps.tasks.list(name)) {
        if (task.stage !== 'pr-opened' || !task.pr) continue;
        const log = (what: string) => (error: unknown) =>
          this.deps.log?.(
            `${what} ${name}/${task.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        // A merged or closed PR needs no conflict watch and no tending.
        const open = await this.observe(task).catch((error: unknown) => (log('pr watch')(error), true));
        if (!open) continue;
        if (!settings.tending.enabled) {
          // Without tending, a conflicting PR still gets help: a follow-up its agent picks up.
          if (this.deps.conflictFollowUp) await this.watchConflict(task).catch(log('conflict watch'));
          continue;
        }
        await this.tend(task, settings).catch(log('tending'));
      }
    }
  }

  /** Reads the task's PR state and reports it; true while the PR is open. */
  async observe(task: TaskRecord): Promise<boolean> {
    const number = Number(/\/pull\/(\d+)/.exec(task.pr?.url ?? '')?.[1]);
    if (!Number.isFinite(number)) return true;
    const pr = await this.github.status(task.worktree?.path ?? task.repo, number);
    await this.deps.prObserved?.(task, pr);
    return pr.state === 'OPEN';
  }

  /** Adds a conflict follow-up when the task's open PR conflicts and none exists for its head. */
  async watchConflict(task: TaskRecord): Promise<boolean> {
    if (task.stage !== 'pr-opened' || !task.pr || !task.worktree || !this.deps.conflictFollowUp) return false;
    const number = Number(/\/pull\/(\d+)/.exec(task.pr.url)?.[1]);
    if (!Number.isFinite(number)) return false;
    const pr = await this.github.pr(task.worktree.path, number);
    if (pr.state !== 'OPEN' || pr.mergeable !== 'CONFLICTING' || conflictFollowUpSeen(task, pr.head_sha))
      return false;
    await this.deps.conflictFollowUp(task, { head_sha: pr.head_sha, base: pr.base });
    this.deps.log?.(`conflict watch ${task.project}/${task.id} PR #${number}: follow-up added`);
    return true;
  }

  /** Tends one PR once: reads it, picks the next action and does it. */
  async tend(task: TaskRecord, settings: ProjectSettings): Promise<TendAction | undefined> {
    const key = `${task.project}/${task.id}`;
    if (this.busy.has(key) || !task.pr || !task.worktree) return undefined;
    this.busy.add(key);
    try {
      const number = Number(/\/pull\/(\d+)/.exec(task.pr.url)?.[1]);
      const cwd = task.worktree.path;
      let record = (await this.record(task)) ?? TendRecord.parse({ number, url: task.pr.url });
      if (record.ended) return undefined;
      if (record.stopped) return { kind: 'wait', reason: `stopped: ${record.stopped.reason}` };
      try {
        const info = await stat(cwd);
        if (!info.isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOENT' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const reason = `Worktree is missing: ${cwd}`;
        const now = new Date().toISOString();
        await this.save(task, { ...record, checked_at: now, last: 'stop', stopped: { reason, at: now } });
        return { kind: 'stop', reason };
      }
      const pr = await this.github.pr(cwd, number);
      const now = new Date().toISOString();
      if (isGreen(pr)) record = { ...record, fixes_since_green: 0 };
      const action = nextTendAction(pr, record, {
        me: await this.github.me(),
        answerThreads: settings.tending.answer_threads,
      });
      record = { ...record, checked_at: now, last: action.kind };
      switch (action.kind) {
        case 'end':
          record.ended = { state: action.state, at: now };
          break;
        case 'stop':
          record.stopped = { reason: action.reason, at: now };
          break;
        case 'wait':
          break;
        case 'rerun':
          for (const id of new Set(action.checks.flatMap((c) => (c.run_id ? [c.run_id] : []))))
            await this.github.rerunFailed(cwd, id);
          record.reruns = [...record.reruns, pr.head_sha];
          record.fixes = [...record.fixes, { kind: 'rerun', at: now, sha: pr.head_sha, outcome: 'rerun' }];
          break;
        default: {
          const release = await this.deps.slot();
          if (!release) return { kind: 'wait', reason: 'every agent slot is in use' };
          try {
            const fix = await this.fix(task, pr, action, cwd, record.setup_key ?? task.worktree.setup_key);
            record.fixes = [...record.fixes, fix.fix];
            if (fix.setupKey) record.setup_key = fix.setupKey;
            if (fix.fix.outcome !== 'no-change') record.fixes_since_green++;
            if (fix.answered.length) record.answered = [...record.answered, ...fix.answered];
          } finally {
            release();
          }
        }
      }
      await this.save(task, record);
      this.deps.log?.(`tending ${key} PR #${number}: ${action.kind}`);
      return action;
    } finally {
      this.busy.delete(key);
    }
  }

  /** Runs an agent fix, checks it and pushes it. Returns what happened and the threads answered. */
  private async fix(
    task: TaskRecord,
    pr: PrState,
    action: Extract<TendAction, { kind: 'merge-base' | 'fix-ci' | 'answer-threads' }>,
    cwd: string,
    installedKey?: string,
  ): Promise<{ fix: TendFix; answered: string[]; setupKey?: string }> {
    const at = new Date().toISOString();
    const branch = task.worktree!.branch;
    const done = (outcome: TendFix['outcome'], cost: number | null, note?: string) => ({
      fix: { kind: action.kind, at, sha: pr.head_sha, outcome, cost_usd: cost, ...(note ? { note } : {}) },
      answered: [] as string[],
    });
    if ((await gitOk(cwd, ['status', '--porcelain'])) !== '')
      return done('failed', null, 'the worktree has uncommitted changes');
    // Start from the PR's head: someone else may have pushed to it.
    await gitOk(cwd, ['fetch', '-q', 'origin', branch, pr.base]);
    const ff = await git(cwd, ['merge', '-q', '--ff-only', `origin/${branch}`]);
    if (ff.code !== 0) return done('failed', null, 'the local branch has diverged from the PR');
    const profile = await this.deps.profile(task.project);
    const before = await gitOk(cwd, ['rev-parse', 'HEAD']);
    let cost: number | null = 0;
    let replies: TendReplies['replies'] = [];
    const agent = async (prompt: string, structured = false) => {
      const result = await this.deps.runner(task).run({
        step: `tend:${action.kind}`,
        model: TEND_MODEL,
        effort: 'medium',
        systemPrompt: SYSTEM,
        prompt,
        cwd,
        tools: 'edit',
        guard: worktreeGuard(cwd, profile, task.allow_protected_paths === true),
        maxTurns: 120,
        maxBudgetUsd: TEND_BUDGET_USD,
        timeoutMs: TEND_TIMEOUT_MS,
        stallMs: 10 * 60_000,
        loopGuard: true,
        ...(structured ? { outputSchema: TEND_REPLIES_SCHEMA } : {}),
      });
      cost = cost === null || result.costUsd === null ? null : cost + result.costUsd;
      return result;
    };
    try {
      if (action.kind === 'merge-base') {
        const merge = await git(cwd, ['merge', '--no-edit', '-q', `origin/${pr.base}`]);
        if (merge.code !== 0) {
          const conflicted = await gitOk(cwd, ['diff', '--name-only', '--diff-filter=U']);
          await agent(
            [
              `Merging ${pr.base} into this PR branch stopped on conflicts in:`,
              conflicted,
              '',
              'Resolve every conflict so both changes keep working. Remove all conflict markers.',
            ].join('\n'),
          );
          // Files stay unmerged until added: look for markers first, then add and check again.
          if (await hasMarkers(cwd)) throw new Error('conflict markers remain after the agent');
          await gitOk(cwd, ['add', '-A']);
          if ((await gitOk(cwd, ['diff', '--name-only', '--diff-filter=U'])) !== '')
            throw new Error('conflicts remain after the agent');
          await gitOk(cwd, ['-c', 'user.useConfigOnly=false', 'commit', '-q', '--no-verify', '--no-edit']);
        }
      } else if (action.kind === 'fix-ci') {
        const logs: string[] = [];
        for (const check of action.checks)
          logs.push(
            `## ${check.name}\n${check.run_id ? await this.github.failedLog(cwd, check.run_id) : `(no log: ${check.link ?? 'no link'})`}`,
          );
        await agent(
          [
            'These CI checks fail on this PR, also after one rerun. Find the cause and fix it.',
            '',
            ...logs,
            '',
            `Run \`${profile.commands.test}\` before you finish.`,
          ].join('\n'),
        );
        await commitAll(cwd, 'Fix failing CI checks');
      } else {
        const result = await agent(
          [
            'Reviewers left these comments on the PR. For each thread: change the code when the comment asks for',
            'a change you agree with, or explain why not. Return one reply per thread.',
            '',
            ...action.threads.map(describeThread),
          ].join('\n'),
          true,
        );
        replies = TendReplies.parse(result.structured).replies.filter((r) =>
          action.threads.some((t) => t.id === r.thread_id),
        );
        await commitAll(cwd, 'Address review comments');
      }
      // The guard cannot see what a Bash command writes. A merged base brings the base's own
      // changes, so only the agent's commits (fix-ci, review) are checked.
      if (action.kind !== 'merge-base') {
        const touched = protectedPaths(
          await changedPathsSince(cwd, before),
          profile.confirmed.forbidden_paths,
          task.allow_protected_paths === true,
        );
        if (touched.length) throw new Error(`the change touches protected paths: ${touched.join(', ')}`);
      }
    } catch (error) {
      await git(cwd, ['merge', '--abort']);
      await git(cwd, ['reset', '-q', '--hard', before]);
      return done('failed', cost, error instanceof Error ? error.message : String(error));
    }
    const head = await gitOk(cwd, ['rev-parse', 'HEAD']);
    let setupKey: string | undefined;
    // A setup or test that prints nothing for this long is stopped, like the driver's checks.
    const stallMs = Math.round(
      (profile.limits?.check_stall_minutes ?? DEFAULT_TASK_LIMITS.check_stall_minutes) * 60_000,
    );
    if (head !== before && profile.commands.setup) {
      // A merged base or a fix may change the lockfile; the test must run on matching dependencies.
      const key = await setupInputsKey(cwd, profile.setup_inputs);
      if (key !== installedKey) {
        const setup = await runShell(profile.commands.setup, {
          cwd,
          timeoutMs: TEST_TIMEOUT_MS,
          stallMs,
          group: true,
        });
        if (setup.code !== 0) {
          await git(cwd, ['reset', '-q', '--hard', before]);
          return done(
            'failed',
            cost,
            `setup (\`${profile.commands.setup}\`) failed after the change: ${(setup.stdout + setup.stderr).slice(-500)}`,
          );
        }
        setupKey = key;
      }
    }
    if (head !== before) {
      const test = await runShell(profile.commands.test, {
        cwd,
        timeoutMs: TEST_TIMEOUT_MS,
        stallMs,
        group: true,
      });
      if (test.code !== 0) {
        await git(cwd, ['reset', '-q', '--hard', before]);
        return done('failed', cost, `the test command failed: ${(test.stdout + test.stderr).slice(-500)}`);
      }
      // A plain push of new commits on top of the PR head: a fast-forward, never a force-push.
      await gitOk(cwd, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`]);
    }
    const answered: string[] = [];
    for (const reply of replies) {
      const thread = (action as { threads?: PrThread[] }).threads!.find((t) => t.id === reply.thread_id)!;
      await this.github.reply(cwd, thread.id, reply.reply);
      if (reply.changed && head !== before) await this.github.resolve(cwd, thread.id);
      answered.push(answeredKey(thread));
    }
    const result = done(head !== before ? 'pushed' : 'no-change', cost);
    return { ...result, answered, ...(setupKey ? { setupKey } : {}) };
  }

  /** PRs whose tending stopped and now wait on the human. */
  async waiting(project: string, tasks: readonly TaskRecord[]): Promise<TendingWaiting[]> {
    const out: TendingWaiting[] = [];
    for (const task of tasks) {
      if (task.project !== project || task.stage !== 'pr-opened') continue;
      const record = await this.record(task);
      if (record?.stopped && !record.ended)
        out.push({
          task_id: task.id,
          number: record.number,
          url: record.url,
          reason: record.stopped.reason,
          since: record.stopped.at,
        });
    }
    return out;
  }
  /** Lets a stopped PR be tended again, with a fresh fix allowance. */
  async resume(task: TaskRecord): Promise<void> {
    const record = await this.record(task);
    if (record) await this.save(task, { ...record, stopped: undefined, fixes_since_green: 0 });
  }
}

function describeThread(t: PrThread): string {
  return [
    `<thread id="${t.id}"${t.path ? ` path="${t.path}"` : ''}${t.line ? ` line="${t.line}"` : ''}>`,
    ...t.comments.map((c) => `${c.author}: ${c.body}`),
    '</thread>',
  ].join('\n');
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await gitOk(cwd, ['add', '-A']);
  if ((await gitOk(cwd, ['diff', '--cached', '--name-only'])) === '') return;
  await gitOk(cwd, ['-c', 'user.useConfigOnly=false', 'commit', '-q', '--no-verify', '-m', message]);
}

async function hasMarkers(cwd: string): Promise<boolean> {
  const r = await git(cwd, ['grep', '-n', '-E', '^(<<<<<<< |>>>>>>> )']);
  return r.code === 0;
}
