import { z } from "zod";

const ladderSchema = z.object({
  name: z.string().min(1),
  rungs: z
    .array(
      z.object({
        name: z.string().min(1),
        model: z.string().startsWith("claude-"),
        effort: z.enum(["low", "medium", "high", "max"]),
      }),
    )
    .min(1)
    .refine(
      (rungs) => new Set(rungs.map((rung) => rung.name)).size === rungs.length,
      {
        message: "Rung names must be unique",
      },
    ),
});

export function validateLadder(input: unknown): z.infer<typeof ladderSchema> {
  return ladderSchema.parse(input);
}
