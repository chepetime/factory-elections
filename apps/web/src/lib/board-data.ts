// Server-only loaders for the board: tasks, run phases and inbox items from the backend, and the
// open PRs from GitHub (through the backend), which are slower and load separately.
import 'server-only';
import { backgroundRun, listTasks } from '@/lib/factory';
import { getInbox } from '@/lib/inbox';
import { listPullRequests } from '@/lib/reviews';
import { mayRun, type BoardInput, type BoardPull, type BoardTask } from '@/lib/board';

export interface BoardLoad {
  input: BoardInput;
  /** Projects whose tasks could not be read, and whether the inbox could not be read. */
  failedProjects: string[];
  inboxFailed: boolean;
}

/** Tasks, run phases and inbox items for the given projects. */
export async function loadBoard(projects: readonly string[]): Promise<BoardLoad> {
  const [lists, inbox] = await Promise.all([Promise.all(projects.map((p) => listTasks(p))), getInbox()]);
  const failedProjects = projects.filter((_, i) => !lists[i]!.ok);
  const tasks = lists.flatMap((l) => (l.ok ? l.value : []));
  const runs = await Promise.all(
    tasks.map(async (task): Promise<BoardTask> => {
      if (!mayRun(task)) return { task };
      const run = await backgroundRun(task.project, task.id);
      return {
        task,
        run: {
          phase: run.phase ?? 'idle',
          ...(run.label ? { label: run.label } : {}),
          ...(run.activity ? { activity: run.activity } : {}),
        },
      };
    }),
  );
  return {
    input: { tasks: runs, ...(inbox.ok ? { inbox: inbox.value.items } : {}) },
    failedProjects,
    inboxFailed: !inbox.ok,
  };
}

/** Projects with at least one task that has a PR: only these need the GitHub list. */
export function projectsWithPulls(input: BoardInput): string[] {
  return [...new Set(input.tasks.filter((t) => t.task.pr).map((t) => t.task.project))];
}

/** Open PRs (drafts and approved included) per project; a project that fails is left out. */
export async function loadPulls(projects: readonly string[]): Promise<Record<string, BoardPull[]>> {
  const lists = await Promise.all(projects.map((p) => listPullRequests(p, true, true)));
  return Object.fromEntries(
    projects.flatMap((p, i) => {
      const list = lists[i]!;
      return list.ok ? [[p, list.value.pulls] as const] : [];
    }),
  );
}
