import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { Effect } from "effect";
import { parse } from "yaml";
import { validateStep } from "../../core/src/step.ts";
import { asError } from "./errors.ts";

export function checkStep(path: string): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const contents = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: asError,
    });
    const step = yield* Effect.try({
      try: () => validateStep(parse(contents) as unknown),
      catch: asError,
    });
    if (isAbsolute(step.prompt))
      return yield* Effect.fail(
        new Error(`Prompt path must be relative: ${step.prompt}`),
      );
    const promptPath = resolve(dirname(path), step.prompt);
    const info = yield* Effect.tryPromise({
      try: () => stat(promptPath),
      catch: asError,
    });
    if (!info.isFile())
      return yield* Effect.fail(
        new Error(`Prompt is not a file: ${promptPath}`),
      );
    return step.name;
  });
}
