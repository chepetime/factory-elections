// What the driver needs from the outside world. The CLI composes concrete adapters into these.
import type { ModelLadder, ModelRunner, RepoProfile, StepDefinition, TaskRecord } from '@factory/core';

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
  commitCountSince(dir: string, base: string): Promise<number>;
  remoteUrl(dir: string): Promise<string | undefined>;
  push(dir: string, branch: string): Promise<void>;
}

export interface ShellPort {
  runShell(
    command: string,
    options: { cwd: string; captureLimit?: number; onOutput?: (chunk: string) => void },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface GitHubPort {
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
}

export class DriverError extends Error {}
