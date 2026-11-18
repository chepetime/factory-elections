// What the driver needs from the outside world. The CLI composes concrete adapters into these.
import type {
  ContextLimits,
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
}

export interface ShellPort {
  runShell(
    command: string,
    options: {
      cwd: string;
      captureLimit?: number;
      onOutput?: (chunk: string) => void;
      timeoutMs?: number;
      signal?: AbortSignal;
      /** Run in its own process group, and stop the whole group on timeout or abort. */
      group?: boolean;
      /** The whole environment of the command; absent: this process's environment. */
      env?: Record<string, string>;
    },
  ): Promise<{ code: number; stdout: string; stderr: string; stopped?: 'timeout' | 'aborted' }>;
}

export interface GitHubPort {
  /** The URL of an open pull request whose head is `head`, if one exists. */
  findOpenPullRequest?(options: { cwd: string; head: string }): Promise<string | undefined>;
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
  }): { endpoint: McpEndpoint; spent(): number; revoke(): void } | undefined;
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
}

export class DriverError extends Error {}
