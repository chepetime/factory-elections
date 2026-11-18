import { z } from 'zod';
import { ModelRef } from './agents.ts';
import { Effort } from './schemas.ts';

/** Declarative specialist configuration; execution and trigger evaluation are separate. */
export const ReviewerDefinition = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    lenses: z.array(z.string().regex(/^[a-z][a-z0-9-]*\.md$/)).min(1),
    trigger: z.enum([
      'always',
      'ticket',
      'standards',
      'tests',
      'security',
      'ui',
      'data-performance',
      'high-risk',
    ]),
    risks: z.array(z.enum(['medium', 'high'])).min(1),
    model: ModelRef,
    high_risk_model: ModelRef.optional(),
    effort: Effort,
    budget_usd: z.number().positive(),
    tools: z.array(z.enum(['read', 'search', 'shell', 'browser'])),
    hunks: z.enum(['all', 'triggered']),
  })
  .strict();
export type ReviewerDefinition = z.infer<typeof ReviewerDefinition>;
