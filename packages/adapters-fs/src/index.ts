// Filesystem task, project, profile and definition storage under the data root.
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { z } from 'zod';
import {
  LoopDefinition,
  ModelLadder,
  Project,
  ProjectName,
  RepoProfile,
  ReviewerDefinition,
  StepDefinition,
  TaskId,
  TaskRecord,
  describeIssues,
} from '@factory/core';

export class FactoryError extends Error {}

export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.FACTORY_ROOT ? resolve(env.FACTORY_ROOT) : join(homedir(), '.local', 'share', 'factory');
}

export function checkProjectName(name: string): string {
  const parsed = ProjectName.safeParse(name);
  if (!parsed.success)
    throw new FactoryError(`invalid project name "${name}": ${describeIssues(parsed.error)}`);
  return parsed.data;
}

export function checkTaskId(id: string): string {
  if (!TaskId.safeParse(id).success) throw new FactoryError(`invalid task id "${id}": must be a UUID`);
  return id;
}

export async function checkRepoDirectory(repo: string): Promise<string> {
  if (!isAbsolute(repo)) throw new FactoryError(`repository path must be absolute: ${repo}`);
  const info = await stat(repo).catch(() => undefined);
  if (!info?.isDirectory()) throw new FactoryError(`repository is not an existing directory: ${repo}`);
  return repo;
}

function validate<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new FactoryError(`invalid ${what}: ${describeIssues(parsed.error)}`);
  return parsed.data;
}

async function readText(path: string, what: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new FactoryError(
      code === 'ENOENT' ? `${what} not found: ${path}` : `cannot read ${what} ${path}: ${code}`,
    );
  }
}

async function readJson(path: string, what: string): Promise<unknown> {
  const text = await readText(path, what);
  try {
    return JSON.parse(text);
  } catch {
    throw new FactoryError(`${what} is not valid JSON: ${path}`);
  }
}

export async function readYamlFile(path: string, what: string): Promise<unknown> {
  const text = await readText(path, what);
  try {
    const { parse } = await import('yaml');
    return parse(text);
  } catch (error) {
    throw new FactoryError(`${what} is not valid YAML: ${path}: ${(error as Error).message}`);
  }
}

/** Writes through a temporary file and rename so readers never see a partial record. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export class TaskStore {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  taskPath(project: string, id: string): string {
    return join(this.root, project, 'tasks', id, 'task.json');
  }

  worktreePath(project: string, id: string): string {
    return join(this.root, project, 'worktrees', id);
  }

  async create(
    project: string,
    repo: string,
    prompt: string,
    now: string,
    jiraKey?: string,
  ): Promise<TaskRecord> {
    checkProjectName(project);
    await checkRepoDirectory(repo);
    if (prompt.trim().length === 0) throw new FactoryError('prompt must not be empty');
    const id = randomUUID();
    const task = validate(
      TaskRecord,
      {
        id,
        project,
        repo,
        prompt,
        ...(jiraKey ? { jira_key: jiraKey } : {}),
        stage: 'queued',
        created_at: now,
        updated_at: now,
        events: [{ at: now, kind: 'stage:queued', message: 'Task submitted' }],
      },
      'task',
    );
    const dir = dirname(this.taskPath(project, id));
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(this.taskPath(project, id), `${JSON.stringify(task, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    return task;
  }

  async read(project: string, id: string): Promise<TaskRecord> {
    checkProjectName(project);
    checkTaskId(id);
    const task = validate(TaskRecord, await readJson(this.taskPath(project, id), 'task file'), 'task file');
    if (task.project !== project || task.id !== id)
      throw new FactoryError(`task file does not match project "${project}" and id "${id}"`);
    return task;
  }

  async write(task: TaskRecord): Promise<void> {
    const checked = validate(TaskRecord, task, 'task');
    await writeJsonAtomic(this.taskPath(checked.project, checked.id), checked);
  }

  /** Serializes CLI mutations across processes; readers continue to see atomic snapshots. */
  async acquireLock(project: string, id: string): Promise<() => Promise<void>> {
    // Validate existence before creating anything, including the lock's parent directory.
    await this.read(project, id);
    const lock = join(dirname(this.taskPath(project, id)), 'command.lock');
    try {
      await writeFile(lock, `${JSON.stringify({ pid: process.pid })}\n`, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new FactoryError(
          `task is locked by another command: ${lock}. If interrupted, confirm its owner has stopped before removing the lock.`,
        );
      throw error;
    }
    return () => rm(lock);
  }

  /**
   * Removes the task's command lock when the process that wrote it no longer exists, and says
   * whether it did. A live PID may be a reused one, so a live PID always keeps the lock.
   */
  async clearDeadLock(project: string, id: string): Promise<boolean> {
    const lock = join(dirname(this.taskPath(project, id)), 'command.lock');
    let pid: unknown;
    try {
      pid = (JSON.parse(await readFile(lock, 'utf8')) as { pid?: unknown }).pid;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      return false;
    }
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false;
    }
    await rm(lock, { force: true });
    return true;
  }

  /**
   * Deletes the task's record and folder. It takes the task's lock first, so a command or run that
   * holds it makes this fail; `before` runs under the lock (for example to remove the worktree).
   */
  async delete(project: string, id: string, before?: (task: TaskRecord) => Promise<void>): Promise<void> {
    checkProjectName(project);
    checkTaskId(id);
    await this.acquireLock(project, id);
    // The lock file is inside the folder, so removing the folder releases it.
    await before?.(await this.read(project, id));
    await rm(dirname(this.taskPath(project, id)), { recursive: true, force: true });
  }

  async withLock<T>(project: string, id: string, action: () => Promise<T>): Promise<T> {
    const release = await this.acquireLock(project, id);
    try {
      return await action();
    } finally {
      await release();
    }
  }

  async list(project: string): Promise<TaskRecord[]> {
    checkProjectName(project);
    const dir = join(this.root, project, 'tasks');
    let names: string[];
    try {
      names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new FactoryError(`cannot read tasks directory ${dir}`);
    }
    const tasks: TaskRecord[] = [];
    for (const name of names.sort()) {
      const task = validate(
        TaskRecord,
        await readJson(join(dir, name, 'task.json'), 'task file'),
        `task file ${name}`,
      );
      if (task.project !== project || task.id !== name)
        throw new FactoryError(`task file ${name} does not match its project or directory`);
      tasks.push(task);
    }
    return tasks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

export class ProjectStore {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  async add(name: string, repo: string): Promise<Project> {
    checkProjectName(name);
    await checkRepoDirectory(repo);
    const dir = join(this.root, name);
    await mkdir(this.root, { recursive: true });
    try {
      await mkdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new FactoryError(`project already exists: ${name}`);
      throw error;
    }
    const project = validate(Project, { name, repo }, 'project');
    try {
      await writeFile(join(dir, 'project.json'), `${JSON.stringify(project, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    return project;
  }

  async read(name: string): Promise<Project> {
    checkProjectName(name);
    const project = validate(
      Project,
      await readJson(join(this.root, name, 'project.json'), 'project record'),
      'project record',
    );
    if (project.name !== name)
      throw new FactoryError(`project record name "${project.name}" does not match "${name}"`);
    return project;
  }

  async list(): Promise<Project[]> {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new FactoryError(`cannot read data root ${this.root}`);
    }
    const projects: Project[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue; // symbolic links report isDirectory() false here
      const file = join(this.root, entry.name, 'project.json');
      const info = await lstat(file).catch(() => undefined);
      if (!info || info.isSymbolicLink()) continue;
      const project = validate(
        Project,
        await readJson(file, 'project record'),
        `project record ${entry.name}`,
      );
      if (project.name !== entry.name)
        throw new FactoryError(`project record ${entry.name} has mismatched name "${project.name}"`);
      projects.push(project);
    }
    return projects.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}

export function profilePath(root: string, project: string): string {
  return join(root, checkProjectName(project), 'profile.yaml');
}

export async function readProfile(root: string, project: string): Promise<RepoProfile> {
  const profile = validate(RepoProfile, await readYamlFile(profilePath(root, project), 'profile'), 'profile');
  if (profile.project !== project)
    throw new FactoryError(`profile project "${profile.project}" does not match "${project}"`);
  return profile;
}

export async function writeProfileDraft(root: string, project: string, text: string): Promise<string> {
  const path = profilePath(root, project);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, text, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new FactoryError(`profile already exists: ${path}`);
    throw error;
  }
  return path;
}

export async function readStepDefinition(path: string): Promise<{ step: StepDefinition; prompt: string }> {
  const step = validate(StepDefinition, await readYamlFile(path, 'step definition'), 'step definition');
  if (isAbsolute(step.prompt)) throw new FactoryError('step prompt must be a relative path');
  const promptPath = resolve(dirname(path), step.prompt);
  const prompt = await readText(promptPath, 'step prompt');
  return { step, prompt };
}

export async function readReviewerDefinition(
  path: string,
  lensDir: string,
): Promise<{ reviewer: ReviewerDefinition; lenses: string[] }> {
  const reviewer = validate(
    ReviewerDefinition,
    await readYamlFile(path, 'reviewer definition'),
    'reviewer definition',
  );
  const lenses = await Promise.all(
    reviewer.lenses.map((name) => readText(join(lensDir, name), 'reviewer lens')),
  );
  return { reviewer, lenses };
}

export async function readLadder(path: string): Promise<ModelLadder> {
  return validate(ModelLadder, await readYamlFile(path, 'model ladder'), 'model ladder');
}

export async function readLoop(path: string): Promise<LoopDefinition> {
  return validate(LoopDefinition, await readYamlFile(path, 'loop definition'), 'loop definition');
}

export async function readJsonFile(path: string, what: string): Promise<unknown> {
  return readJson(path, what);
}

export async function isReadableDirectory(
  path: string,
): Promise<'available' | 'not_initialized' | 'unavailable'> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) return 'unavailable';
    await access(path, constants.R_OK);
    return 'available';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not_initialized' : 'unavailable';
  }
}
