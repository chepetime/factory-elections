#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { createTask } from "../packages/core/src/task.ts";
import { saveTask } from "../packages/filesystem/src/tasks.ts";

async function main(args: string[]): Promise<void> {
  if (args.includes("--help") && args[0] !== "intake") {
    console.log("Usage: factory [options]");
    return;
  }
  if (args[0] !== "intake") return;
  let project: string | undefined;
  let repo: string | undefined;
  let prompt: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--project" || arg === "--repo") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      if (arg === "--project") project = value;
      else repo = value;
    } else if (prompt !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    } else {
      prompt = arg;
    }
  }
  if (project === undefined || repo === undefined || prompt === undefined)
    throw new Error("Missing intake argument");
  const task = createTask(randomUUID(), project, repo, prompt);
  await saveTask(
    process.env.FACTORY_ROOT ?? join(homedir(), ".local", "share", "factory"),
    task,
  );
  console.log(task.id);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
