import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { parse } from "yaml";
import { validateProfile } from "../../core/src/profile.ts";
import { validateProject } from "../../core/src/task.ts";
import { asError } from "./errors.ts";

export function checkProfile(
  root: string,
  project: string,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    yield* Effect.try({ try: () => validateProject(project), catch: asError });
    const path = join(root, project, "profile.yaml");
    const contents = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: asError,
    });
    yield* Effect.try({
      try: () => validateProfile(parse(contents) as unknown, project),
      catch: asError,
    });
  });
}
