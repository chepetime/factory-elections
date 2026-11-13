#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { createTask } from "../packages/core/src/task.ts";
import {
  listTasks,
  saveTask,
  showTask,
} from "../packages/filesystem/src/tasks.ts";
import { checkProfile } from "../packages/filesystem/src/profiles.ts";
import { checkStep } from "../packages/filesystem/src/steps.ts";
import { checkLadder } from "../packages/filesystem/src/ladders.ts";
import { checkLoop } from "../packages/filesystem/src/loops.ts";
import { checkVerdict } from "../packages/filesystem/src/verdicts.ts";

class Filesystem extends Context.Tag("factory/Filesystem")<
  Filesystem,
  {
    saveTask: typeof saveTask;
    showTask: typeof showTask;
    listTasks: typeof listTasks;
    checkProfile: typeof checkProfile;
    checkStep: typeof checkStep;
    checkLadder: typeof checkLadder;
    checkLoop: typeof checkLoop;
    checkVerdict: typeof checkVerdict;
  }
>() {}

const filesystemLive = Layer.succeed(Filesystem, {
  saveTask,
  showTask,
  listTasks,
  checkProfile,
  checkStep,
  checkLadder,
  checkLoop,
  checkVerdict,
});

function main(args: string[]): Effect.Effect<void, Error, Filesystem> {
  return Effect.gen(function* () {
    const filesystem = yield* Filesystem;
    if (
      args.includes("--help") &&
      args[0] !== "intake" &&
      args[0] !== "task" &&
      args[0] !== "verdict"
    ) {
      console.log("Usage: factory [options]");
      return;
    }
    if (args[0] === "verdict") {
      if (args.length !== 3 || args[1] !== "check" || !args[2])
        return yield* Effect.fail(
          new Error("Usage: factory verdict check <path>"),
        );
      const id = yield* filesystem.checkVerdict(args[2]);
      console.log(`Verdict valid: ${id}`);
      return;
    }
    if (args[0] === "definition") {
      if (
        args.length !== 3 ||
        (args[1] !== "check-step" &&
          args[1] !== "check-ladder" &&
          args[1] !== "check-loop") ||
        !args[2]
      )
        return yield* Effect.fail(
          new Error(
            "Usage: factory definition <check-step|check-ladder|check-loop> <path>",
          ),
        );
      if (args[1] === "check-loop") {
        const name = yield* filesystem.checkLoop(args[2]);
        console.log(`Loop valid: ${name}`);
      } else if (args[1] === "check-ladder") {
        const name = yield* filesystem.checkLadder(args[2]);
        console.log(`Ladder valid: ${name}`);
      } else {
        const name = yield* filesystem.checkStep(args[2]);
        console.log(`Step valid: ${name}`);
      }
      return;
    }
    if (args[0] === "task") {
      if (args[1] === "list") {
        if (args.length !== 4 || args[2] !== "--project" || !args[3])
          return yield* Effect.fail(
            new Error("Usage: factory task list --project <project>"),
          );
        const records = yield* filesystem.listTasks(
          process.env.FACTORY_ROOT ??
            join(homedir(), ".local", "share", "factory"),
          args[3],
        );
        console.log(JSON.stringify(records));
        return;
      }
      if (args[1] !== "show" || args.length !== 6)
        return yield* Effect.fail(
          new Error("Usage: factory task show --project <project> --id <id>"),
        );
      const options = new Map<string, string>();
      for (let i = 2; i < args.length; i += 2) {
        const key = args[i];
        const value = args[i + 1];
        if (
          (key !== "--project" && key !== "--id") ||
          !value ||
          value.startsWith("--") ||
          options.has(key)
        )
          return yield* Effect.fail(new Error("Invalid task show arguments"));
        options.set(key, value);
      }
      const project = options.get("--project");
      const id = options.get("--id");
      if (!project || !id)
        return yield* Effect.fail(new Error("Missing task show arguments"));
      const record = yield* filesystem.showTask(
        process.env.FACTORY_ROOT ??
          join(homedir(), ".local", "share", "factory"),
        project,
        id,
      );
      console.log(JSON.stringify(record));
      return;
    }
    if (args[0] === "profile") {
      if (
        args.length !== 4 ||
        args[1] !== "check" ||
        args[2] !== "--project" ||
        !args[3]
      )
        return yield* Effect.fail(
          new Error("Usage: factory profile check --project <project>"),
        );
      const project = args[3];
      yield* filesystem.checkProfile(
        process.env.FACTORY_ROOT ??
          join(homedir(), ".local", "share", "factory"),
        project,
      );
      console.log(`Profile valid: ${project}`);
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
          return yield* Effect.fail(new Error(`Missing value for ${arg}`));
        if (arg === "--project") project = value;
        else repo = value;
      } else if (prompt !== undefined) {
        return yield* Effect.fail(new Error(`Unexpected argument: ${arg}`));
      } else {
        prompt = arg;
      }
    }
    if (project === undefined || repo === undefined || prompt === undefined)
      return yield* Effect.fail(new Error("Missing intake argument"));
    const task = yield* Effect.try({
      try: () => createTask(randomUUID(), project, repo, prompt),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause), { cause }),
    });
    yield* filesystem.saveTask(
      process.env.FACTORY_ROOT ?? join(homedir(), ".local", "share", "factory"),
      task,
    );
    console.log(task.id);
  });
}

Effect.runPromise(
  main(process.argv.slice(2)).pipe(Effect.provide(filesystemLive)),
).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
