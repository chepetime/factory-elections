import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Ajv2020 as AjvType } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";

const require = createRequire(import.meta.url);
const Ajv2020: typeof AjvType = require("ajv/dist/2020.js");
const addFormats: FormatsPlugin = require("ajv-formats");
import { isAbsolute, join } from "node:path";
import { Effect } from "effect";
import { validateProject, type Task } from "../../core/src/task.ts";
import { asError } from "./errors.ts";

export function showTask(
  root: string,
  project: string,
  id: string,
): Effect.Effect<unknown, Error> {
  return Effect.tryPromise({
    try: async () => {
      validateProject(project);
      const ajv = new Ajv2020();
      addFormats(ajv);
      if (!ajv.validate({ type: "string", format: "uuid" }, id))
        throw new Error("Invalid task id: expected UUID");
      const schema = JSON.parse(
        await readFile(
          new URL(
            "../../../resources/task-record.schema.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const validate = ajv.compile(schema);
      const record: unknown = JSON.parse(
        await readFile(join(root, project, "tasks", id, "task.json"), "utf8"),
      );
      if (!validate(record))
        throw new Error(
          `Invalid task record: ${ajv.errorsText(validate.errors)}`,
        );
      const task = record as Task;
      if (task.id !== id || task.project !== project)
        throw new Error("Task record id or project does not match arguments");
      return record;
    },
    catch: asError,
  });
}

export function listTasks(
  root: string,
  project: string,
): Effect.Effect<unknown[], Error> {
  return Effect.gen(function* () {
    yield* Effect.try({ try: () => validateProject(project), catch: asError });
    const entries = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readdir(join(root, project, "tasks"), {
            withFileTypes: true,
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }
      },
      catch: asError,
    });
    const records: unknown[] = [];
    for (const entry of entries) {
      if (entry.isDirectory())
        records.push(yield* showTask(root, project, entry.name));
    }
    records.sort((a, b) => {
      const left = (a as Task).id;
      const right = (b as Task).id;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    return records;
  });
}

export function saveTask(root: string, task: Task): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    if (!isAbsolute(task.repo))
      return yield* Effect.fail(new Error("Repository path must be absolute"));
    const info = yield* Effect.tryPromise({
      try: () => stat(task.repo),
      catch: asError,
    });
    if (!info.isDirectory())
      return yield* Effect.fail(
        new Error("Repository path must be a directory"),
      );
    const dir = join(root, task.project, "tasks", task.id);
    yield* Effect.tryPromise({
      try: () => mkdir(dir, { recursive: true }),
      catch: asError,
    });
    yield* Effect.tryPromise({
      try: () =>
        writeFile(join(dir, "task.json"), JSON.stringify(task), { flag: "wx" }),
      catch: asError,
    });
  });
}
