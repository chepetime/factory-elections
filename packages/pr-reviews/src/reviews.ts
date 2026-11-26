import type { PrReviewStore } from './pr-review-records.ts';
// PR reviews: the `elections review` workflow, owned by the backend. Each review is a chat with a
// headless Claude Code session in a dedicated worktree. The factory's copy of the senior-pr-review
// skill (definitions/skills/senior-pr-review) is appended to the system prompt on every turn, and
// the agent saves its report as a JSON payload that the web app renders.
//
// Worktrees use the CLI's location, so either tool can reuse them:
//   <repo parent>/reviews/<repo>-<branch slug>   on local branch review/<branch>
// Chat records live in the data root:
//   <root>/<project>/reviews/<N>/run.json        PR, session and user turns
//   <root>/<project>/reviews/<N>/turn-<K>.jsonl  stream-json output of turn K (+ turn-<K>.exit)
//
// A Claude turn runs in this process on the Agent SDK (ADR 0005, phase 3): the backend owns its
// abort and result, and writes the same log and exit files. A turn whose owner is not this
// backend instance and has no exit file was interrupted. FACTORY_REVIEW_TRANSPORT=cli, and other
// providers, still run turns as detached CLI processes with a PID.
//   <root>/<project>/reviews/<N>/payload.json    the report payload the agent writes
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ProjectName,
  PullRequestNode,
  ReviewPayload,
  reviewContext,
  reviewConversation,
  reviewKickoff,
  eventSession,
  contextLimit,
  contextStatus,
  digestSession,
  missingCapabilities,
  agentEnvironment,
  envNames,
  newSpanId,
  newTraceId,
  spanTokens,
  ToolSpans,
  type AgentEvent,
  type ReviewWaiting,
  triagePullRequests,
  type AgentCli,
  type HeadlessTurn,
  type ProjectSettings,
} from '@factory/core';
import { type ProjectStore, writeJsonAtomic } from '@factory/adapters-fs';
import {
  addWorktreeAt,
  fetchAllPrune,
  remoteBranchExists,
  removeWorktree,
  resetWorktreeHard,
  worktreePaths,
} from '@factory/adapters-git';
import { githubLogin, openPullRequestNodes, pullRequestHead } from '@factory/adapters-github';
import { isAlive, spawnDetached, stopGroup } from '@factory/adapters-process';
import {
  claudeCli,
  runClaudeTurn,
  type ClaudeTurnRequest,
  type ClaudeTurnResult,
} from '@factory/adapters-claude';
import { Conflict } from '@factory/core';
import { MAX_AGENTS } from '@factory/dispatcher';
import type { ReviewDelegation, ReviewGrant, ReviewMemory } from './ports.ts';
import type { TraceLog } from '@factory/evidence';
import {
  headLines,
  PrNumber,
  readLines,
  registered,
  ReviewMode,
  ReviewTarget,
  RunFile,
  reviewWorktree,
} from './review-files.ts';
import { missingReportReason, offeredTools, permissionModeOf } from './review-turn-log.ts';
import type { ReviewDetail, ReviewFindingRow, ReviewRow, ReviewStatus } from './review-types.ts';

export { reviewWorktree } from './review-files.ts';
export { missingReportReason, permissionModeOf } from './review-turn-log.ts';
export type * from './review-types.ts';

export const SKILL_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'definitions',
  'skills',
  'senior-pr-review',
);
/** A review turn with no new output for this long is stopped. Claude Code's Bash tool stops a
 * command after 10 minutes at most, so a working agent always writes output well within this. */
export const REVIEW_STALL_MS = Number(process.env.FACTORY_REVIEW_STALL_MS ?? 30 * 60_000);
/** Most one review turn may spend. */
export const REVIEW_TURN_BUDGET_USD = Number(process.env.FACTORY_REVIEW_BUDGET_USD ?? 25);
/** Most the child tasks of one review turn may spend together. */
export const REVIEW_DELEGATE_BUDGET_USD = Number(process.env.FACTORY_REVIEW_DELEGATE_BUDGET_USD ?? 10);
/**
 * GitHub and git writes the agent may not make on its own. Kickoff and re-review turns get this
 * list; a message the user typed does not, so the user can still ask the agent to post.
 */
export const AUTOMATED_TURN_DENY = [
  'Bash(gh pr review:*)',
  'Bash(gh pr comment:*)',
  'Bash(gh pr merge:*)',
  'Bash(gh pr close:*)',
  'Bash(gh pr edit:*)',
  'Bash(gh pr ready:*)',
  'Bash(gh issue comment:*)',
  'Bash(gh issue create:*)',
  'Bash(gh issue edit:*)',
  'Bash(gh api:*)',
  'Bash(git push:*)',
];
/** One review turn, as the provider CLI receives it. */
export type AgentTurn = HeadlessTurn;
export interface ReviewDeps {
  github: {
    login(): Promise<string>;
    nodes(cwd: string, me: string): Promise<unknown[]>;
    pull(cwd: string, number: number): Promise<{ branch: string; url: string; title?: string }>;
  };
  /** The provider that runs review turns. Automated turns need its deny rules. */
  agent: AgentCli;
  skillDir: string;
  /** Runs a Claude turn in-process on the SDK. Absent: Claude turns run as detached CLI processes. */
  claudeTurn?: (request: ClaudeTurnRequest) => Promise<ClaudeTurnResult>;
}

export const defaultReviewDeps: ReviewDeps = {
  github: { login: githubLogin, nodes: openPullRequestNodes, pull: pullRequestHead },
  agent: claudeCli,
  skillDir: SKILL_DIR,
  ...(process.env.FACTORY_REVIEW_TRANSPORT === 'cli' ? {} : { claudeTurn: runClaudeTurn }),
};

/**
 * The agent allowlist (packages/core/src/agent-env.ts), not the backend's environment. It also
 * keeps out CLAUDECODE and CLAUDE_CODE_*, so the agent does not think it is nested in the session
 * that started the backend.
 */
function agentEnv(provider: AgentCli['id']): NodeJS.ProcessEnv {
  return agentEnvironment(provider, process.env, envNames(process.env.FACTORY_AGENT_ENV_ALLOW));
}

/** The review model, for its context limit. */
const REVIEW_MODEL = 'claude-opus-5-5';

function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n/, '').trimStart();
}

export class ReviewService {
  private readonly root: string;
  private readonly projects: ProjectStore;
  private readonly settings: (project: string) => Promise<ProjectSettings>;
  private readonly deps: ReviewDeps;
  private login?: { value: string; at: number };
  private readonly busy = new Set<string>();
  /** PRs accepted for review whose worktree is still being prepared. */
  private readonly preparing = new Set<string>();
  /** Why a PR's last accepted start failed, until the next start. */
  private readonly failures = new Map<string, string>();
  private readonly batches = new Set<Promise<void>>();
  /** Serializes acceptance, so two starts cannot both take the last free agent slot. */
  private accepting: Promise<unknown> = Promise.resolve();
  private readonly otherAgents: () => number;
  private sweeper?: ReturnType<typeof setInterval>;
  /** Starts `delegate` child tasks for review turns, when the backend runs the server. */
  delegation?: ReviewDelegation;
  /** Repository facts for the system prompt; finished turns teach it, and its tool pruning applies. */
  memory?: ReviewMemory;
  /** Writes a span for each finished turn, with its tool calls. */
  traces?: TraceLog;
  reviewRecords?: PrReviewStore;
  /**
   * Called once when a review's first turn ends: with its payload when it finished with a decision,
   * or undefined when it stopped or failed. The backend's review loop listens here.
   */
  /** A first review turn ended: its payload, or why there is none. */
  onReviewEnded?: (
    project: string,
    number: number,
    payload: ReviewPayload | undefined,
    reason?: string,
  ) => unknown;
  /** The live grant of each PR's latest turn; a new turn replaces it. */
  private readonly grants = new Map<string, ReviewGrant>();
  /** This backend instance, the owner of the in-process turns it starts. */
  readonly instance = randomUUID();
  /** In-process turns that run now, by PR. */
  private readonly turnsRunning = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private closing = false;
  constructor(
    root: string,
    projects: ProjectStore,
    settings: (project: string) => Promise<ProjectSettings>,
    deps: ReviewDeps = defaultReviewDeps,
    /** Agents running outside this service (task runs), counted against MAX_AGENTS. */
    otherAgents: () => number = () => 0,
  ) {
    this.root = root;
    this.projects = projects;
    this.settings = settings;
    this.deps = deps;
    this.otherAgents = otherAgents;
  }
  /** Resolves when every accepted batch has started its agents or failed. */
  async idle(): Promise<void> {
    while (this.batches.size) await Promise.all(this.batches);
  }
  /** Checks every minute for review turns that stopped producing output. */
  startSweeping(everyMs = 60_000): void {
    this.sweeper ??= setInterval(() => void this.sweep().catch(() => undefined), everyMs);
    this.sweeper.unref();
  }
  stopSweeping(): void {
    clearInterval(this.sweeper);
    this.sweeper = undefined;
  }
  /** Stops running turns with no new output for `stallMs`. Returns the PRs it stopped. */
  async sweep(stallMs = REVIEW_STALL_MS): Promise<string[]> {
    const stopped: string[] = [];
    for (const project of await this.projects.list()) {
      for (const number of await this.reviewNumbers(project.name)) {
        const record = await this.readRun(project.name, number).catch(() => undefined);
        if (!record) continue;
        const state = (await this.status(project.name, record, false)).state;
        if (state !== 'running') {
          await this.learn(project.name, record).catch(() => undefined);
          continue;
        }
        const k = record.turns.length - 1;
        const turn = record.turns[k]!;
        const log = await stat(join(this.dir(project.name, number), `turn-${k}.jsonl`)).catch(
          () => undefined,
        );
        const last = Math.max(Date.parse(turn.at), log?.mtimeMs ?? 0);
        if (Date.now() - last < stallMs) continue;
        this.stopTurn(project.name, number, turn);
        const turns = [...record.turns];
        turns[k] = { ...turn, stopped: true, stop_reason: 'stalled' };
        await writeJsonAtomic(join(this.dir(project.name, number), 'run.json'), { ...record, turns });
        stopped.push(`${project.name}#${number}`);
      }
    }
    return stopped;
  }

  /** Each review of the project whose latest turn ended, for the inbox. */
  async waiting(project: string): Promise<ReviewWaiting[]> {
    const out: ReviewWaiting[] = [];
    for (const number of await this.reviewNumbers(project)) {
      const record = await this.readRun(project, number).catch(() => undefined);
      if (!record) continue;
      const status = await this.status(project, record, false);
      if (!status.state || ['running', 'preparing'].includes(status.state)) continue;
      out.push({
        number,
        url: record.url,
        ...(record.title ? { title: record.title } : {}),
        state: status.state,
        finished_at: status.finished_at ?? record.turns.at(-1)!.at,
        ...(status.decision ? { decision: status.decision } : {}),
      });
    }
    return out;
  }

  /** Gives memory each finished turn once: its digest, and which tools it was offered and used. */
  async learn(project: string, record: RunFile): Promise<void> {
    if (!this.memory && !this.traces && !this.reviewRecords) return;
    const dir = this.dir(project, record.number);
    for (let k = 0; k < record.turns.length; k++) {
      const marker = join(dir, `turn-${k}.learned`);
      if (await stat(marker).catch(() => undefined)) continue;
      if (!(await stat(join(dir, `turn-${k}.exit`)).catch(() => undefined)) && !record.turns[k]!.stopped)
        continue;
      const lines = await readLines(join(dir, `turn-${k}.jsonl`));
      const events = lines.flatMap((l) => this.deps.agent.parse(l));
      const head = await headLines(join(dir, `turn-${k}.jsonl`));
      const offered = offeredTools(head);
      await this.traceTurn(project, record, k, events).catch(() => undefined);
      // The first turn's result, for the review loop: the payload when the turn finished with one.
      if (k === 0 && this.onReviewEnded) {
        const exit = await readFile(join(dir, `turn-${k}.exit`), 'utf8').catch(() => '');
        const stopped = record.turns[k]!.stopped === true;
        const read = exit.trim() === '0' && !stopped ? await this.readPayload(project, record.number) : {};
        const payload = read.payload?.meta.decision?.trim() ? read.payload : undefined;
        const reason = payload
          ? undefined
          : missingReportReason(events, {
              exit: exit.trim(),
              stopped,
              payloadError: read.error,
              permissionMode: permissionModeOf(head),
            });
        await Promise.resolve(this.onReviewEnded(project, record.number, payload, reason)).catch(
          () => undefined,
        );
      }
      if (k === 0 && this.reviewRecords && !record.turns[k]!.stopped) {
        const exitPath = join(dir, `turn-${k}.exit`);
        const exit = await readFile(exitPath, 'utf8').catch(() => '');
        const completed = await stat(exitPath).catch(() => undefined);
        const payloadFile = await stat(join(dir, 'payload.json')).catch(() => undefined);
        const payload = (await this.readPayload(project, record.number)).payload;
        const turn = record.turns[k]!;
        if (
          exit.trim() === '0' &&
          completed &&
          payloadFile &&
          payloadFile.mtimeMs >= Date.parse(turn.at) - 1000 &&
          payload?.meta.decision?.trim()
        ) {
          await this.reviewRecords.add(project, {
            source_id: `review:${record.number}:${turn.trace_id ?? turn.at}`,
            pr_number: record.number,
            reviewer: { kind: 'agent', identity: this.deps.agent.id },
            verdict: payload.meta.decision,
            findings: payload.findings.map((finding) => ({
              text:
                finding.comment?.trim() ||
                finding.title?.trim() ||
                finding.explanation?.trim() ||
                'Review finding',
              ...(finding.file?.trim() ? { path: finding.file.trim() } : {}),
              ...(finding.severity?.trim() ? { severity: finding.severity.trim() } : {}),
              ...(finding.evidence?.length ? { evidence: finding.evidence } : {}),
            })),
            reviewed_at: completed.mtime.toISOString(),
            duration_ms: Math.max(0, Math.round(completed.mtimeMs - Date.parse(turn.at))),
          });
        }
      }
      if (events.length && this.memory) {
        await this.memory.record(
          project,
          digestSession(
            {
              id: `review:${record.number}:${k}`,
              at: record.turns[k]!.at,
              kind: 'review-turn',
              provider: this.deps.agent.id,
            },
            events,
          ),
        );
        if (offered.length)
          await this.memory.recordTools(
            project,
            offered,
            events.flatMap((e) => (e.type === 'tool' ? [e.name] : [])),
          );
      }
      await writeFile(marker, '');
    }
  }

  /** The finished turn's span, with its tool calls under it (the log has no tool timings). */
  private async traceTurn(project: string, record: RunFile, k: number, events: AgentEvent[]): Promise<void> {
    if (!this.traces) return;
    const turn = record.turns[k]!;
    const dir = this.dir(project, record.number);
    const ended = (await stat(join(dir, `turn-${k}.exit`)).catch(() => undefined))?.mtime ?? new Date();
    const result = events.findLast((e) => e.type === 'result');
    const tools = new ToolSpans();
    for (const e of events) tools.event(e);
    const scope = {
      trace_id: turn.trace_id ?? newTraceId(),
      project,
      pr: { url: record.url, number: record.number },
    };
    const spanId = turn.span_id ?? newSpanId();
    const grant = this.grants.get(`${project}#${record.number}`);
    if (grant && k === record.turns.length - 1) this.traces.unbindGrant(grant.endpoint.token);
    this.traces.append(scope, {
      span_id: spanId,
      type: 'review',
      name: turn.label ?? (k === 0 ? 'review' : 'review reply'),
      step: 'review',
      model: REVIEW_MODEL,
      provider: this.deps.agent.id,
      gateway: 'direct',
      started_at: turn.at,
      ended_at: ended.toISOString(),
      duration_ms: Math.max(0, ended.getTime() - Date.parse(turn.at)),
      outcome: turn.stopped ? 'aborted' : result?.ok === false ? 'failed' : 'completed',
      cost_usd: result?.costUsd ?? null,
      ...(result?.usage ? { tokens: spanTokens(result.usage) } : {}),
      attributes: { turn: k },
    });
    this.traces.append({ ...scope, parent_span_id: spanId }, ...tools.finish(false));
    await this.traces.flush();
  }

  private dir(project: string, number: number): string {
    return join(this.root, project, 'reviews', String(number));
  }
  private async me(): Promise<string> {
    if (!this.login || Date.now() - this.login.at > 3_600_000)
      this.login = { value: await this.deps.github.login(), at: Date.now() };
    return this.login.value;
  }
  private async readRun(project: string, number: number): Promise<RunFile | undefined> {
    try {
      return RunFile.parse(JSON.parse(await readFile(join(this.dir(project, number), 'run.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  private async readPayload(
    project: string,
    number: number,
  ): Promise<{ payload?: ReviewPayload; error?: string }> {
    const path = join(this.dir(project, number), 'payload.json');
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      return {};
    }
    try {
      const parsed = ReviewPayload.safeParse(JSON.parse(text));
      return parsed.success
        ? { payload: parsed.data }
        : { error: `The report payload has an unexpected shape: ${parsed.error.issues[0]?.message}` };
    } catch {
      return { error: 'The report payload is not valid JSON.' };
    }
  }

  private async status(
    project: string,
    record: RunFile | undefined,
    worktree: boolean,
  ): Promise<ReviewStatus> {
    const key = record && `${project}#${record.number}`;
    if (!record) return { turns: 0, report: false, worktree };
    const number = record.number;
    const { payload } = await this.readPayload(project, number);
    const status: ReviewStatus = {
      turns: record.turns.length,
      started_at: record.started_at,
      report: payload !== undefined,
      decision: payload?.meta.decision ?? undefined,
      risk: payload?.meta.risk_level ?? undefined,
      worktree,
    };
    const k = record.turns.length - 1;
    const turn = record.turns[k]!;
    const exitFile = join(this.dir(project, number), `turn-${k}.exit`);
    const done = await stat(exitFile).catch(() => undefined);
    if (done) {
      status.exit_code = Number((await readFile(exitFile, 'utf8')).trim());
      status.finished_at = done.mtime.toISOString();
      status.state = turn.stopped ? 'stopped' : status.exit_code === 0 ? 'completed' : 'failed';
    } else if (turn.stopped) status.state = 'stopped';
    else if (turn.owner)
      status.state =
        turn.owner === this.instance && this.turnsRunning.has(`${project}#${number}`)
          ? 'running'
          : 'interrupted';
    else status.state = turn.pid && isAlive(turn.pid) ? 'running' : 'interrupted';
    if (turn.stop_reason) status.stop_reason = turn.stop_reason;
    void key;
    return status;
  }
  /** Adds what only this process knows: a start being prepared, or why the last one failed. */
  private live(project: string, number: number, status: ReviewStatus): ReviewStatus {
    const key = `${project}#${number}`;
    if (this.preparing.has(key) && status.state !== 'running') return { ...status, state: 'preparing' };
    const error = this.failures.get(key);
    return error ? { ...status, error } : status;
  }

  async list(raw: unknown): Promise<{ me: string; pulls: ReviewRow[] }> {
    const { project, drafts, approved } = z
      .object({
        project: ProjectName,
        drafts: z.boolean().default(false),
        approved: z.boolean().default(false),
      })
      .parse(raw);
    const { repo } = await this.projects.read(project);
    const me = await this.me();
    const nodes = z.array(PullRequestNode).parse(await this.deps.github.nodes(repo, me));
    const worktrees = await worktreePaths(repo);
    const pulls = await Promise.all(
      triagePullRequests(nodes, me, { drafts, approved }).map(async (pr) => {
        const record = await this.readRun(project, pr.number);
        const tree = reviewWorktree(repo, record?.branch ?? pr.branch).path;
        const status = await this.status(project, record, await registered(worktrees, tree));
        return { ...pr, review: this.live(project, pr.number, status) };
      }),
    );
    return { me, pulls };
  }

  /**
   * Every finding the saved review reports of a project hold, newest review first. Reads only
   * files on disk: no GitHub call, so the list works offline and for closed PRs.
   */
  async findings(raw: unknown): Promise<ReviewFindingRow[]> {
    const { project } = z.object({ project: ProjectName }).parse(raw);
    const dir = join(this.root, project, 'reviews');
    const numbers = (await readdir(dir).catch(() => [] as string[]))
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    const rows = await Promise.all(
      numbers.map(async (number) => {
        const record = await this.readRun(project, number).catch(() => undefined);
        const { payload } = await this.readPayload(project, number);
        if (!record || !payload) return [];
        const at = record.turns.at(-1)?.at ?? record.started_at;
        return payload.findings.map((f, index) => ({
          project,
          number,
          index,
          title: record.title ?? payload.meta.pr_title ?? `PR #${number}`,
          url: record.url,
          at,
          decision: payload.meta.decision ?? undefined,
          severity: f.severity ?? undefined,
          axis: f.axis ?? undefined,
          finding: f.title ?? f.impact ?? 'Untitled finding',
          file: f.file ?? undefined,
          line_range: f.line_range ?? undefined,
          fix: f.fix ?? undefined,
        }));
      }),
    );
    return rows.flat().sort((a, b) => b.at.localeCompare(a.at) || a.index - b.index);
  }

  async detail(raw: unknown): Promise<ReviewDetail> {
    const { project, number } = ReviewTarget.parse(raw);
    const { repo } = await this.projects.read(project);
    const record = await this.readRun(project, number);
    const worktree =
      record !== undefined &&
      (await registered(await worktreePaths(repo), reviewWorktree(repo, record.branch).path));
    const status = this.live(project, number, await this.status(project, record, worktree));
    if (!record) return { ...status, number, can_reply: false, conversation: [] };
    const dir = this.dir(project, number);
    const turns = await Promise.all(
      record.turns.map(async (t, k) => ({
        at: t.at,
        text: t.text,
        label: t.label,
        lines: await readLines(join(dir, `turn-${k}.jsonl`)),
      })),
    );
    const parsed = turns.map((t) => ({ ...t, events: t.lines.flatMap((l) => this.deps.agent.parse(l)) }));
    const conversation = reviewConversation(parsed);
    let tokens = 0;
    for (const e of parsed.at(-1)!.events) if (e.type === 'context') tokens = e.tokens;
    const settings = await this.settings(project).catch(() => undefined);
    const context = tokens
      ? contextStatus(tokens, contextLimit(settings?.context_tokens, REVIEW_MODEL))
      : undefined;
    // A turn that never produced stream JSON (e.g. the agent failed to start) still explains itself.
    const last = turns.at(-1)!;
    if (status.state !== 'running' && conversation.at(-1)?.role === 'user' && last.lines.length)
      conversation.push({
        role: 'agent',
        id: `a${turns.length - 1}`,
        at: last.at,
        blocks: [{ kind: 'text', text: last.lines.slice(-12).join('\n') }],
      });
    const { payload, error } = await this.readPayload(project, number);
    const costs = conversation.flatMap((e) =>
      e.role === 'agent' && e.result?.costUsd !== undefined ? [e.result.costUsd] : [],
    );
    return {
      ...status,
      ...(costs.length ? { cost_usd: costs.reduce((a, b) => a + b, 0) } : {}),
      ...(context ? { context } : {}),
      number,
      branch: record.branch,
      url: record.url,
      title: record.title,
      can_reply:
        status.state !== 'running' &&
        status.state !== 'preparing' &&
        worktree &&
        (await this.sessionOf(project, record)) !== undefined,
      conversation,
      payload,
      payload_error: error,
    };
  }

  private async sessionOf(project: string, record: RunFile): Promise<string | undefined> {
    const dir = this.dir(project, record.number);
    // The latest turn that reported a session wins: a resumed session may get a new id.
    for (let k = record.turns.length - 1; k >= 0; k--) {
      const lines = await headLines(join(dir, `turn-${k}.jsonl`));
      const id = eventSession(lines.flatMap((l) => this.deps.agent.parse(l)));
      if (id) return id;
    }
    return record.session_id;
  }

  private async reviewNumbers(project: string): Promise<number[]> {
    const names = await readdir(join(this.root, project, 'reviews')).catch(() => [] as string[]);
    return names.filter((n) => /^\d+$/.test(n)).map(Number);
  }
  /** Review agents running or being prepared, in every project. */
  async agentsInUse(): Promise<number> {
    let count = this.preparing.size;
    for (const project of await this.projects.list())
      for (const number of await this.reviewNumbers(project.name)) {
        const record = await this.readRun(project.name, number).catch(() => undefined);
        if ((await this.status(project.name, record, false)).state === 'running') count++;
      }
    return count;
  }

  private async guard<T>(project: string, number: number, work: () => Promise<T>): Promise<T> {
    const key = `${project}#${number}`;
    if (this.busy.has(key)) throw new Conflict(`PR #${number} is busy`);
    this.busy.add(key);
    try {
      return await work();
    } finally {
      this.busy.delete(key);
    }
  }

  /** Starts an agent turn: writes the system prompt, spawns the agent and records the turn. */
  private async spawnTurn(
    project: string,
    record: Omit<RunFile, 'turns'> & { turns: RunFile['turns'] },
    message: { text: string; label?: string },
    resume: string | undefined,
    automated: boolean,
  ): Promise<void> {
    const dir = this.dir(project, record.number);
    await mkdir(join(dir, 'work'), { recursive: true });
    const settings = await this.settings(project);
    const skill = stripFrontmatter(await readFile(join(this.deps.skillDir, 'SKILL.md'), 'utf8'));
    const context = reviewContext({
      skillDir: this.deps.skillDir,
      payload: join(dir, 'payload.json'),
      workDir: join(dir, 'work'),
      pr: { number: record.number, branch: record.branch, url: record.url },
      profile: settings.review_profile,
      taskManager: settings.task_manager,
    });
    const agent = this.deps.agent;
    const refusal = automated ? missingCapabilities(agent.id, ['denyRules']) : undefined;
    if (refusal) throw new Conflict(`Automated review turns cannot run on ${agent.id}: ${refusal}`);
    const facts = await this.memory?.prompt(project);
    const systemPrompt = [skill, context, facts].filter(Boolean).join('\n\n');
    const pruned = (await this.memory?.pruned(project)) ?? [];
    const known = pruned.length ? ((await this.memory?.toolUsage(project))?.known ?? []) : [];
    const systemPromptFile = join(dir, 'system-prompt.md');
    await writeFile(systemPromptFile, systemPrompt);
    const k = record.turns.length;
    await rm(join(dir, `turn-${k}.exit`), { force: true });
    const key = `${project}#${record.number}`;
    this.grants.get(key)?.revoke();
    this.grants.delete(key);
    // Review children may only read: the review reads code, and the user decides what to change.
    const grant = this.delegation?.grant({
      label: `review ${key}`,
      cwd: record.worktree,
      access: 'read-only',
      budgetUsd: REVIEW_DELEGATE_BUDGET_USD,
    });
    if (grant) this.grants.set(key, grant);
    // The turn's span is written when it ends; children started meanwhile hang under its id.
    const traceId = newTraceId();
    const spanId = newSpanId();
    if (grant)
      this.traces?.bindGrant(grant.endpoint.token, {
        trace_id: traceId,
        project,
        parent_span_id: spanId,
        pr: { url: record.url, number: record.number },
      });
    const turn: AgentTurn = {
      message: message.text,
      systemPromptFile,
      resume,
      budgetUsd: REVIEW_TURN_BUDGET_USD,
      deny: automated ? AUTOMATED_TURN_DENY : [],
      ...(grant ? { mcp: grant.endpoint } : {}),
      ...(pruned.length && known.length ? { tools: known.filter((t) => !pruned.includes(t)) } : {}),
    };
    const inProcess = agent.id === 'claude' && this.deps.claudeTurn;
    const pid = inProcess
      ? undefined
      : spawnDetached(agent.command, agent.args(turn, { systemPrompt }), {
          cwd: record.worktree,
          env: { ...agentEnv(agent.id), ...agent.env?.(turn) },
          logPath: join(dir, `turn-${k}.jsonl`),
          exitPath: join(dir, `turn-${k}.exit`),
        });
    const next: RunFile = {
      ...record,
      session_id: resume ?? record.session_id,
      turns: [
        ...record.turns,
        {
          at: new Date().toISOString(),
          text: message.text,
          label: message.label,
          ...(pid ? { pid } : { owner: this.instance }),
          trace_id: traceId,
          span_id: spanId,
        },
      ],
    };
    // The turn is recorded before an in-process turn starts, so status sees it as running.
    await writeJsonAtomic(join(dir, 'run.json'), next);
    if (inProcess) this.runInProcess(key, dir, k, inProcess, { turn, systemPrompt, cwd: record.worktree });
  }

  /**
   * Runs a Claude turn in this process. Its SDK messages go to the turn log; the exit file says
   * how it ended (0 or 1). A turn that the backend aborted at shutdown writes no exit file, so it
   * reads as interrupted, and a reply can continue its saved session.
   */
  private runInProcess(
    key: string,
    dir: string,
    k: number,
    run: NonNullable<ReviewDeps['claudeTurn']>,
    request: Pick<ClaudeTurnRequest, 'turn' | 'systemPrompt' | 'cwd'>,
  ): void {
    const controller = new AbortController();
    const done = (async () => {
      const log = createWriteStream(join(dir, `turn-${k}.jsonl`), { flags: 'a' });
      let result: ClaudeTurnResult;
      try {
        result = await run({
          ...request,
          env: agentEnv('claude'),
          signal: controller.signal,
          onLine: (line) => log.write(`${line}\n`),
        });
      } catch (error) {
        result = {
          ok: false,
          aborted: controller.signal.aborted,
          reported: false,
          error: (error as Error).message,
        };
      }
      // A failure the SDK did not report as a result message still shows in the chat.
      if (!result.reported && !result.aborted && result.error)
        log.write(
          `${JSON.stringify({ type: 'result', subtype: 'error', is_error: true, errors: [result.error] })}\n`,
        );
      await new Promise<void>((resolveEnd) => log.end(resolveEnd));
      if (!this.closing) await writeFile(join(dir, `turn-${k}.exit`), result.ok ? '0\n' : '1\n');
    })()
      .catch(() => undefined)
      .finally(() => {
        if (this.turnsRunning.get(key)?.controller === controller) this.turnsRunning.delete(key);
      });
    this.turnsRunning.set(key, { controller, done });
  }

  /** Stops a turn on whichever path it runs: the in-process abort, or the detached group. */
  private stopTurn(project: string, number: number, turn: RunFile['turns'][number]): void {
    const live = this.turnsRunning.get(`${project}#${number}`);
    if (turn.owner === this.instance && live) live.controller.abort();
    else if (turn.pid) stopGroup(turn.pid);
  }

  /**
   * Shutdown, like a task run's drain: in-process turns get `graceMs` to finish on their own.
   * Then the rest are aborted. They write no exit file, so the next backend reads them as
   * interrupted, and a reply continues their session. Nothing replays them automatically.
   */
  async close(graceMs = 0): Promise<void> {
    const running = [...this.turnsRunning.values()];
    if (graceMs > 0 && running.length)
      await Promise.race([
        Promise.all(running.map((turn) => turn.done)),
        new Promise((done) => setTimeout(done, graceMs).unref()),
      ]);
    this.closing = true;
    const live = [...this.turnsRunning.values()];
    for (const turn of live) turn.controller.abort();
    await Promise.all(live.map((turn) => turn.done));
  }

  /**
   * Accepts a review (or re-review) of each PR and returns at once. `review` starts a new chat;
   * `rereview` continues the existing one. The fetch (once per batch), the GitHub lookup and the
   * worktree reset run afterwards; a failure there shows as the PR's `error`.
   */
  async start(raw: unknown): Promise<{ number: number; ok: boolean; error?: string }[]> {
    const { project, numbers, mode } = z
      .object({ project: ProjectName, numbers: z.array(PrNumber).min(1).max(20), mode: ReviewMode })
      .parse(raw);
    const { repo } = await this.projects.read(project);
    const accept = this.accepting.then(() => this.accept(project, [...new Set(numbers)], mode));
    this.accepting = accept.catch(() => undefined);
    const { results, accepted } = await accept;
    if (accepted.length) {
      const batch: Promise<void> = this.prepare(project, repo, accepted, mode).finally(() =>
        this.batches.delete(batch),
      );
      this.batches.add(batch);
    }
    return results;
  }
  private async accept(project: string, numbers: number[], mode: ReviewMode) {
    const results: { number: number; ok: boolean; error?: string }[] = [];
    const accepted: number[] = [];
    let inUse = (await this.agentsInUse()) + this.otherAgents();
    for (const number of numbers) {
      const key = `${project}#${number}`;
      try {
        const previous = await this.readRun(project, number);
        if (this.preparing.has(key) || (await this.status(project, previous, false)).state === 'running')
          throw new Conflict(`PR #${number} is already being reviewed`);
        if (inUse >= MAX_AGENTS)
          throw new Conflict(`At most ${MAX_AGENTS} agents can run at once; wait for one to finish`);
        if (mode === 'rereview' && !(previous && (await this.sessionOf(project, previous))))
          throw new Conflict(`PR #${number} has no review chat to continue`);
        this.preparing.add(key);
        this.failures.delete(key);
        inUse++;
        accepted.push(number);
        results.push({ number, ok: true });
      } catch (error) {
        results.push({ number, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { results, accepted };
  }
  private async prepare(project: string, repo: string, numbers: number[], mode: ReviewMode): Promise<void> {
    let fetchError: unknown;
    await fetchAllPrune(repo).catch((error: unknown) => (fetchError = error));
    for (const number of numbers) {
      const key = `${project}#${number}`;
      try {
        if (fetchError) throw fetchError;
        await this.guard(project, number, () => this.startOne(project, repo, number, mode));
      } catch (error) {
        this.failures.set(key, error instanceof Error ? error.message : String(error));
      } finally {
        this.preparing.delete(key);
      }
    }
  }
  private async startOne(project: string, repo: string, number: number, mode: ReviewMode): Promise<void> {
    const previous = await this.readRun(project, number);
    if ((await this.status(project, previous, false)).state === 'running')
      throw new Conflict(`PR #${number} is already being reviewed`);
    const session = previous && (await this.sessionOf(project, previous));
    if (mode === 'rereview' && !session) throw new Conflict(`PR #${number} has no review chat to continue`);
    const { branch, url, title } = await this.deps.github.pull(repo, number);
    const tree = reviewWorktree(repo, branch);
    const hasWorktree = await registered(await worktreePaths(repo), tree.path);
    if (mode === 'rereview' && !hasWorktree)
      throw new Conflict(`No review worktree for ${branch}; review it first`);
    if (!(await remoteBranchExists(repo, branch)))
      throw new Conflict(`Remote branch origin/${branch} not found`);
    if (!hasWorktree) {
      await mkdir(dirname(tree.path), { recursive: true });
      await addWorktreeAt(repo, tree.path, tree.branch, `origin/${branch}`);
    }
    await resetWorktreeHard(tree.path, `origin/${branch}`);
    const prUrl = url || previous?.url || '';
    const kickoff = {
      text: reviewKickoff(mode, { number, branch }),
      label: mode === 'rereview' ? 'Re-review' : 'Review',
    };
    if (mode === 'rereview' && previous) {
      await this.spawnTurn(
        project,
        { ...previous, branch, url: prUrl || previous.url, title: title || previous.title },
        kickoff,
        session,
        true,
      );
      return;
    }
    const dir = this.dir(project, number);
    await rm(dir, { recursive: true, force: true });
    await this.spawnTurn(
      project,
      {
        number,
        branch,
        url: prUrl,
        title,
        worktree: tree.path,
        started_at: new Date().toISOString(),
        turns: [],
      },
      kickoff,
      undefined,
      true,
    );
  }

  /** Continues the review chat with the user's message. */
  async reply(raw: unknown): Promise<void> {
    const { project, number, text } = ReviewTarget.extend({
      text: z.string().trim().min(1).max(50_000),
    }).parse(raw);
    await this.guard(project, number, async () => {
      if (this.preparing.has(`${project}#${number}`))
        throw new Conflict('Wait for the agent to finish, or stop it, before sending another message');
      const record = await this.readRun(project, number);
      if (!record) throw new Conflict(`PR #${number} has no review chat`);
      const { repo } = await this.projects.read(project);
      if ((await this.status(project, record, false)).state === 'running')
        throw new Conflict('Wait for the agent to finish, or stop it, before sending another message');
      if (!(await registered(await worktreePaths(repo), record.worktree)))
        throw new Conflict('The review worktree is gone; start a new review');
      const session = await this.sessionOf(project, record);
      if (!session) throw new Conflict('This chat has no session to continue; start a new review');
      await this.spawnTurn(project, record, { text }, session, false);
    });
  }

  async stop(raw: unknown): Promise<void> {
    const { project, number } = ReviewTarget.parse(raw);
    const record = await this.readRun(project, number);
    if (!record) throw new Conflict(`PR #${number} has no review to stop`);
    const turns = [...record.turns];
    const last = turns.at(-1)!;
    // A turn that already ended keeps its result: a late Stop must not relabel a completed review.
    const exit = join(this.dir(project, number), `turn-${turns.length - 1}.exit`);
    if (await stat(exit).catch(() => undefined)) return;
    this.stopTurn(project, number, last);
    turns[turns.length - 1] = { ...last, stopped: true };
    await writeJsonAtomic(join(this.dir(project, number), 'run.json'), { ...record, turns });
  }

  /** Removes the PR's review worktree, its review/<branch> branch, and its chat and report. */
  async remove(raw: unknown): Promise<void> {
    const { project, number } = ReviewTarget.parse(raw);
    await this.guard(project, number, async () => {
      const { repo } = await this.projects.read(project);
      const record = await this.readRun(project, number);
      if (
        this.preparing.has(`${project}#${number}`) ||
        (await this.status(project, record, false)).state === 'running'
      )
        throw new Conflict(`Stop the review of PR #${number} before removing it`);
      const branch = record?.branch ?? (await this.deps.github.pull(repo, number)).branch;
      const tree = reviewWorktree(repo, branch);
      // Best effort, like the CLI: a missing worktree or branch is already removed.
      await removeWorktree(repo, tree.path, tree.branch);
      await rm(this.dir(project, number), { recursive: true, force: true });
    });
  }
}
