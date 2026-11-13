import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { parse } from "yaml";
import { validateLadder } from "../../core/src/ladder.ts";
import { asError } from "./errors.ts";

export function checkLadder(path: string): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const contents = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: asError,
    });
    const ladder = yield* Effect.try({
      try: () => validateLadder(parse(contents) as unknown),
      catch: asError,
    });
    return ladder.name;
  });
}
