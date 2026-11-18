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
//   <root>/<project>/reviews/<N>/payload.json    the report payload the agent writes
import { mkdir, open, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ProjectName,
  PullRequestNode,
  ReviewPayload,
  reviewContext,
  reviewConversation,
  reviewKickoff,
  streamSessionId,
  triagePullRequests,
  type ProjectSettings,
  type PullRequestSummary,
  type ReviewChatEntry,
  type ReviewState,
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
import { Conflict } from './conflict.ts';

export const SKILL_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'definitions',
  'skills',
  'senior-pr-review',
);
/** Agents that may run at once on the machine's one Claude sign-in: reviews plus task runs. */
export const MAX_AGENTS = Number(process.env.FACTORY_MAX_AGENTS ?? 6);
/** A review turn with no new output for this long is stopped. Claude Code's Bash tool stops a
 * command after 10 minutes at most, so a working agent always writes output well within this. */
export const REVIEW_STALL_MS = Number(process.env.FACTORY_REVIEW_STALL_MS ?? 30 * 60_000);
/** Most one review turn may spend. */
export const REVIEW_TURN_BUDGET_USD = Number(process.env.FACTORY_REVIEW_BUDGET_USD ?? 25);
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
const PrNumber = z.number().int().positive().max(1_000_000_000);
const ReviewTarget = z.object({ project: ProjectName, number: PrNumber });
const ReviewMode = z.enum(['review', 'rereview']);
type ReviewMode = z.infer<typeof ReviewMode>;
const Turn = z.object({
  at: z.string(),
  text: z.string(),
  label: z.string().optional(),
  pid: z.number().int().positive(),
  stopped: z.boolean().optional(),
  /** Set when the backend stopped the turn, not the user. */
  stop_reason: z.enum(['stalled']).optional(),
});
const RunFile = z.object({
  number: PrNumber,
  branch: z.string().min(1),
  url: z.string(),
  title: z.string().optional(),
  worktree: z.string(),
  started_at: z.string(),
  session_id: z.string().optional(),
  turns: z.array(Turn).min(1),
});
type RunFile = z.infer<typeof RunFile>;

export interface ReviewStatus {
  /** State of the latest agent turn. */
  state?: ReviewState;
  started_at?: string;
  finished_at?: string;
  exit_code?: number;
  /** User messages in the chat, including the kickoff. */
  turns: number;
  /** The agent saved a report payload. */
  report: boolean;
  /** Verdict and risk from the payload, for the list. */
  decision?: string;
  risk?: string;
  /** A review worktree is registered for this PR's branch. */
  worktree: boolean;
  /** Why the last start failed after it was accepted (fetching the PR or preparing its worktree). */
  error?: string;
  stop_reason?: 'stalled';
}
export interface ReviewRow extends PullRequestSummary {
  review: ReviewStatus;
}
export interface ReviewDetail extends ReviewStatus {
  number: number;
  branch?: string;
  url?: string;
  title?: string;
  /** Whether a follow-up message can continue this chat now. */
  can_reply: boolean;
  conversation: ReviewChatEntry[];
  payload?: ReviewPayload;
  payload_error?: string;
  /** Dollars the agent reported over all turns; absent when no turn reported a cost. */
  cost_usd?: number;
}

export interface AgentTurn {
  message: string;
  systemPromptFile: string;
  /** The session to continue; absent for a new chat. */
  resume?: string;
  /** Most this turn may spend. */
  budgetUsd: number;
  /** Tool rules this turn may not use. */
  deny: readonly string[];
}
export interface ReviewDeps {
  github: {
    login(): Promise<string>;
    nodes(cwd: string, me: string): Promise<unknown[]>;
    pull(cwd: string, number: number): Promise<{ branch: string; url: string; title?: string }>;
  };
  agent: { command: string; args(turn: AgentTurn): string[] };
  skillDir: string;
}

export const defaultReviewDeps: ReviewDeps = {
  github: { login: githubLogin, nodes: openPullRequestNodes, pull: pullRequestHead },
  agent: {
    command: 'claude',
    // Same runner as the CLI (`claude --dangerously-skip-permissions --model claude-opus-5-5`),
    // headless with a streamed event log so the web app can show the chat.
    args: (turn) => [
      '-p',
      '--dangerously-skip-permissions',
      '--model',
      'claude-opus-5-5',
      '--output-format',
      'stream-json',
      '--verbose',
      '--append-system-prompt-file',
      turn.systemPromptFile,
      '--max-budget-usd',
      String(turn.budgetUsd),
      ...(turn.deny.length ? ['--disallowedTools', ...turn.deny] : []),
      ...(turn.resume ? ['--resume', turn.resume] : []),
      // Ends the variadic tool list, so the message is never read as a tool rule.
      '--',
      turn.message,
    ],
  },
  skillDir: SKILL_DIR,
};

export function reviewWorktree(repo: string, branch: string) {
  return {
    path: join(dirname(repo), 'reviews', `${basename(repo)}-${branch.replaceAll('/', '-')}`),
    branch: `review/${branch}`,
  };
}

/** Whether git lists this worktree. Git reports resolved paths (e.g. /private/var on macOS). */
async function registered(worktrees: readonly string[], path: string): Promise<boolean> {
  if (worktrees.includes(path)) return true;
  const real = await realpath(path).catch(() => undefined);
  return real !== undefined && worktrees.includes(real);
}

/** Lines of a stream-json log, keeping at most the last `bytes`. */
async function readLines(path: string, bytes = 4 * 1024 * 1024): Promise<string[]> {
  const file = await open(path, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!file) return [];
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await file.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim() !== '');
  } finally {
    await file.close();
  }
}

/** The first lines of a file, reading at most `bytes`. */
async function headLines(path: string, bytes = 64 * 1024): Promise<string[]> {
  const file = await open(path, 'r').catch(() => undefined);
  if (!file) return [];
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (bytesRead === bytes) lines.pop();
    return lines.filter((l) => l.trim() !== '');
  } finally {
    await file.close();
  }
}

/** The agent must not think it is nested inside the session that started the backend. */
function agentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key];
  return env;
}

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
        if (!record || (await this.status(project.name, record, false)).state !== 'running') continue;
        const k = record.turns.length - 1;
        const turn = record.turns[k]!;
        const log = await stat(join(this.dir(project.name, number), `turn-${k}.jsonl`)).catch(
          () => undefined,
        );
        const last = Math.max(Date.parse(turn.at), log?.mtimeMs ?? 0);
        if (Date.now() - last < stallMs) continue;
        stopGroup(turn.pid);
        const turns = [...record.turns];
        turns[k] = { ...turn, stopped: true, stop_reason: 'stalled' };
        await writeJsonAtomic(join(this.dir(project.name, number), 'run.json'), { ...record, turns });
        stopped.push(`${project.name}#${number}`);
      }
    }
    return stopped;
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
    else status.state = isAlive(turn.pid) ? 'running' : 'interrupted';
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
    const conversation = reviewConversation(turns);
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
      const id = streamSessionId(await headLines(join(dir, `turn-${k}.jsonl`)));
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
    const systemPromptFile = join(dir, 'system-prompt.md');
    await writeFile(systemPromptFile, `${skill}\n\n${context}`);
    const k = record.turns.length;
    await rm(join(dir, `turn-${k}.exit`), { force: true });
    const pid = spawnDetached(
      this.deps.agent.command,
      this.deps.agent.args({
        message: message.text,
        systemPromptFile,
        resume,
        budgetUsd: REVIEW_TURN_BUDGET_USD,
        deny: automated ? AUTOMATED_TURN_DENY : [],
      }),
      {
        cwd: record.worktree,
        env: agentEnv(),
        logPath: join(dir, `turn-${k}.jsonl`),
        exitPath: join(dir, `turn-${k}.exit`),
      },
    );
    const next: RunFile = {
      ...record,
      session_id: resume ?? record.session_id,
      turns: [
        ...record.turns,
        { at: new Date().toISOString(), text: message.text, label: message.label, pid },
      ],
    };
    await writeJsonAtomic(join(dir, 'run.json'), next);
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
    stopGroup(last.pid);
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
