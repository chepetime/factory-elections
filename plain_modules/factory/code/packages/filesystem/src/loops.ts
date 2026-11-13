import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { parse } from "yaml";
import { validateLoop } from "../../core/src/loop.ts";
import { asError } from "./errors.ts";

export function checkLoop(path: string): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const contents = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: asError,
    });
    const loop = yield* Effect.try({
      try: () => validateLoop(parse(contents) as unknown),
      catch: asError,
    });
    return loop.name;
  });
}
