import { z } from "zod";

const nonempty = z.string().min(1);
const stepSchema = z.object({
  name: nonempty,
  prompt: nonempty,
  model: nonempty,
  inputs: z.array(nonempty),
  outputs: z.array(nonempty),
});

export function validateStep(input: unknown): z.infer<typeof stepSchema> {
  return stepSchema.parse(input);
}
