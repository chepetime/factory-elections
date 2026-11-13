import { mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Task } from "../../core/src/task.ts";

export async function saveTask(root: string, task: Task): Promise<void> {
  if (!isAbsolute(task.repo))
    throw new Error("Repository path must be absolute");
  const info = await stat(task.repo);
  if (!info.isDirectory())
    throw new Error("Repository path must be a directory");
  const dir = join(root, task.project, "tasks", task.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "task.json"), JSON.stringify(task), { flag: "wx" });
}
