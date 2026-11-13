import { z } from "zod";

const nonempty = z.string().min(1);
const profileSchema = z.object({
  project: nonempty,
  approved_at: nonempty,
  repo: z.object({
    base_branch: z.object({ value: nonempty, source: nonempty }),
  }),
  commands: z.object({ test: nonempty, full_check: nonempty }),
  confirmed: z.object({
    forbidden_paths: z.array(z.string()),
    forbidden_commands: z.array(z.string()),
  }),
  design_sources: z.array(z.string()),
  qa_targets: z.array(z.string()),
});

export function validateProfile(input: unknown, project: string): void {
  const profile = profileSchema.parse(input);
  if (profile.project !== project)
    throw new Error(`Profile project does not match ${project}`);
}
