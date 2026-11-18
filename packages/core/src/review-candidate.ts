import { z } from 'zod';

/** A specialist's proposed finding before the lead verifies and deduplicates it. */
export const ReviewCandidate = z
  .object({
    file: z.string().min(1),
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
    quoted_hunk: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
    proposed_severity: z.string().min(1),
    confidence: z.string().min(1),
    specialist: z.string().min(1),
  })
  .refine((candidate) => candidate.end_line >= candidate.start_line, {
    message: 'End line must not precede start line',
    path: ['end_line'],
  });
export type ReviewCandidate = z.infer<typeof ReviewCandidate>;
