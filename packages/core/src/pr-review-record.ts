import { z } from 'zod';

/** A review by a person or agent of a project pull request. */
export const PrReviewRecord = z.object({
  id: z.uuid(),
  pr_number: z.number().int().positive(),
  reviewer: z.object({ kind: z.enum(['human', 'agent']), identity: z.string().trim().min(1).max(200) }),
  verdict: z.string().trim().min(1).max(100),
  findings: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(10000),
        path: z.string().trim().min(1).max(2000).optional(),
        line: z.number().int().positive().optional(),
        severity: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .max(500),
  reviewed_at: z.iso.datetime(),
  duration_ms: z.number().int().nonnegative(),
});
export type PrReviewRecord = z.infer<typeof PrReviewRecord>;
export const NewPrReviewRecord = PrReviewRecord.omit({ id: true });
