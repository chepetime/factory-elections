import { z } from "zod";

const required = [
  ["step", "coder"],
  ["gate", "verify"],
  ["step", "reviewer"],
  ["gate", "human-review"],
  ["gate", "decisions-clear"],
  ["gate", "open-pr"],
] as const;

const loopSchema = z
  .object({
    name: z.string().min(1),
    produces_code: z.boolean(),
    entries: z
      .array(
        z.object({ kind: z.enum(["step", "gate"]), name: z.string().min(1) }),
      )
      .min(1),
  })
  .refine(
    (loop) => {
      if (!loop.produces_code) return true;
      let next = 0;
      for (const entry of loop.entries) {
        if (
          next < required.length &&
          entry.kind === required[next][0] &&
          entry.name === required[next][1]
        )
          next++;
      }
      return next === required.length;
    },
    {
      message:
        "Code-producing loops must contain coder, verify, reviewer, human-review, decisions-clear and open-pr in order with the required kinds",
    },
  );

export function validateLoop(input: unknown): z.infer<typeof loopSchema> {
  return loopSchema.parse(input);
}
