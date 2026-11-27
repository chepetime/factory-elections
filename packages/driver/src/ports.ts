// What the driver needs from the outside world. The CLI composes concrete adapters into these.
import type {
  ContextLimits,
  Effort,
  FactoryTool,
  McpEndpoint,
  ModelLadder,
  ModelRun,
  ModelRunner,
  RepoProfile,
  StepDefinition,
  TaskRecord,
  ToolGuard,
} from '@factory/core';

export interface TaskStorePort {
  read(project: string, id: string): Promise<TaskRecord>;
  write(task: TaskRecord): Promise<void>;
  worktreePath(project: string, id: string): string;
}

export interface GitPort {
  topLevel(dir: string): Promise<string | undefined>;
  commonRepo(dir: string): Promise<string | undefined>;
  isClean(dir: string): Promise<boolean>;
  dirtyFiles(dir: string): Promise<string[]>;
  /** Tracked paths with uncommitted changes; untracked files are left out. */
  changedFiles(dir: string): Promise<string[]>;
  branchExists(repo: string, branch: string): Promise<boolean>;
  currentBranch(dir: string): Promise<string>;
  headSha(dir: string): Promise<string>;
  addWorktree(repo: string, path: string, branch: string, base: string): Promise<void>;
  removeWorktree(repo: string, path: string, branch: string): Promise<void>;
  stageAll(dir: string): Promise<string[]>;
  unstageAll(dir: string): Promise<void>;
  commit(dir: string, message: string): Promise<string>;
  addedOrModifiedSince(dir: string, base: string): Promise<string[]>;
  diffSince(dir: string, base: string, stat?: boolean): Promise<string>;
  diffLineCounts(
    dir: string,
    base: string,
  ): Promise<{ path: string; added: number | null; deleted: number | null }[]>;
  commitCountSince(dir: string, base: string): Promise<number>;
  remoteUrl(dir: string): Promise<string | undefined>;
  push(dir: string, branch: string): Promise<void>;
  /** Whether origin has this branch (after the last fetch or push). */
  remoteBranchExists?(repo: string, branch: string): Promise<boolean>;
  /** Ignores a pattern in this repository only, without a committed .gitignore change. */
  excludeLocally?(dir: string, pattern: string): Promise<void>;
  /** Fetches these refs from origin. Follow-ups need it, with the next four. */
  fetchRefs?(dir: string, refs: string[]): Promise<void>;
  /** Fast-forwards the current branch to `ref`; false when it has diverged. */
  fastForwardTo?(dir: string, ref: string): Promise<boolean>;
  /** Merges `ref`: committed when clean, else left in progress with the conflicted paths. */
  mergeRef?(dir: string, ref: string): Promise<{ clean: boolean; conflicted: string[] }>;
  mergeInProgress?(dir: string): Promise<boolean>;
  abortMerge?(dir: string): Promise<void>;
}

export interface ShellPort {
  runShell(
    command: string,
    options: {
      cwd: string;
      captureLimit?: number;
      onOutput?: (chunk: string) => void;
      timeoutMs?: number;
      /** Stop the command when it prints nothing for this long. */
      stallMs?: number;
      signal?: AbortSignal;
      /** Run in its own process group, and stop the whole group on timeout or abort. */
      group?: boolean;
      /** The whole environment of the command; absent: this process's environment. */
      env?: Record<string, string>;
    },
  ): Promise<{ code: number; stdout: string; stderr: string; stopped?: 'timeout' | 'aborted' | 'stalled' }>;
}

export interface GitHubPort {
  /**
   * The pull requests from branch `head` in any state, with the commit each one points at. Opening
   * a PR reads this first, so a write that GitHub kept and the task record lost is found again.
   */
  pullRequestsFrom(options: {
    cwd: string;
    head: string;
  }): Promise<{ url: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; head_sha: string }[]>;
  createPullRequest(options: {
    cwd: string;
    base: string;
    head: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<string>;
}

export interface DefinitionsPort {
  readStep(path: string): Promise<{ step: StepDefinition; prompt: string }>;
  readLadder(path: string): Promise<ModelLadder>;
  exists(path: string): Promise<boolean>;
}

export interface StepPaths {
  step: string;
  ladder: string;
}

/** Lets a model call start child tasks with the `delegate` tool (the backend's MCP server). */
export interface DelegationPort {
  grant(options: {
    label: string;
    cwd: string;
    access: 'read-only' | 'edit';
    sandbox?: ModelRun['sandbox'];
    budgetUsd: number;
    guard?: ToolGuard;
    signal?: AbortSignal;
    runner?: ModelRunner;
    tools?: readonly FactoryTool[];
  }): { endpoint: McpEndpoint; spent(): number; revoke(): void } | undefined;
}

/** What a workspace agent's session on a task needs, built by the backend from the agent and the board. */
export interface AgentSession {
  /** The agent's name, for progress lines and events. */
  name: string;
  model: string;
  effort: Effort;
  /** Factory instructions, the agent's notes and its skills. */
  systemPrompt: string;
  /** The task with its comments; with a reply, the person's reply for a resumed session. */
  prompt: string;
  /** Spend limit for the whole task session, resumes included. */
  budgetUsd: number;
  /** Host env names to pass; the backend keeps only names its operator allows (FACTORY_AGENT_ENV_ALLOW). */
  passEnv: readonly string[];
  /** The factory tools for this task (comment, set_status). */
  tools: readonly FactoryTool[];
  /** The status the agent set with set_status during the session, read when it ends. */
  reported(): 'in_progress' | 'in_review' | 'blocked' | undefined;
}

export interface DriverDeps {
  tasks: TaskStorePort;
  readProfile(project: string): Promise<RepoProfile>;
  git: GitPort;
  shell: ShellPort;
  github: GitHubPort;
  runner: ModelRunner;
  definitions: DefinitionsPort;
  /** `prWriter` is optional: without it, pull requests use the task-summary description. */
  steps: { classifier: StepPaths; coder: StepPaths; reviewer: StepPaths; prWriter?: StepPaths };
  now(): string;
  /** Progress for the human, written to standard error by the CLI. */
  log(line: string): void;
  /** Aborted when the run must stop (backend shutdown). Model calls and checks stop with it. */
  signal?: AbortSignal;
  /** Absent: no step can start child tasks. */
  delegation?: DelegationPort;
  /** Confirmed repository facts for system prompts (the backend's memory). */
  repositoryFacts?(project: string): Promise<string | undefined>;
  /** The project's context size limits; absent: the default. */
  contextLimits?(project: string): Promise<ContextLimits | undefined>;
  /** Builds an agent run's session; `reply` is the person's comment that resumes it. Absent: no agent runs. */
  agentSession?(task: TaskRecord, reply?: string): Promise<AgentSession>;
}

export class DriverError extends Error {}
