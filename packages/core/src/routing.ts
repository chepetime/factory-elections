import { z } from 'zod';
import { ProviderId } from './agents.ts';
import { Effort } from './schemas.ts';

/** Inputs available to a router. History and health are observations, not routing policy. */
export const RouteContext = z.object({
  step: z.string().min(1),
  task_class: z.string().min(1),
  size: z.string().min(1),
  risk: z.string().min(1),
  history: z.array(
    z
      .object({
        provider: ProviderId,
        model: z.string().min(1),
        runs: z.number().int().nonnegative(),
        first_passes: z.number().int().nonnegative(),
        median_cost_usd: z.number().nonnegative(),
      })
      .refine((h) => h.first_passes <= h.runs),
  ),
  provider_health: z.array(
    z.object({ provider: ProviderId, available: z.boolean(), usage_limit_resets_at: z.string().optional() }),
  ),
  budget_left_usd: z.number().nonnegative(),
});
export type RouteContext = z.infer<typeof RouteContext>;

/** The router's selected call settings. */
export const RouteDecision = z.object({
  provider: ProviderId,
  model: z.string().min(1),
  effort: Effort,
  gateway: z.string().min(1),
  budget_usd: z.number().nonnegative(),
});
export type RouteDecision = z.infer<typeof RouteDecision>;
