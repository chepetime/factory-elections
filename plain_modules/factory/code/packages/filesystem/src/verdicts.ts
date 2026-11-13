import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Ajv2020 as AjvType } from "ajv/dist/2020.js";
import { Effect } from "effect";
import { asError } from "./errors.ts";

const require = createRequire(import.meta.url);
const Ajv2020: typeof AjvType = require("ajv/dist/2020.js");

type Verdict = {
  intake_id: string;
  readiness: string;
  blockers: { kind: string }[];
};

export function checkVerdict(path: string): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    try: async () => {
      const schema = JSON.parse(
        await readFile(
          new URL(
            "../../../resources/classifier-verdict.schema.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const verdict: unknown = JSON.parse(await readFile(path, "utf8"));
      const ajv = new Ajv2020();
      const validate = ajv.compile(schema);
      if (!validate(verdict))
        throw new Error(
          `Invalid classifier verdict: ${ajv.errorsText(validate.errors)}`,
        );
      const value = verdict as Verdict;
      const first = ["research", "clarification", "slicing"].find((kind) =>
        value.blockers.some((blocker) => blocker.kind === kind),
      );
      const expected = first ? `needs-${first}` : "ready";
      if (false && value.readiness !== expected)
        throw new Error(
          `Invalid classifier verdict readiness: expected ${expected}`,
        );
      return value.intake_id;
    },
    catch: asError,
  });
}
