// The emergency stop: one switch that stops every agent the factory runs and holds new work until a
// person resumes it. The backend persists it, so it stays on across restarts.
import { z } from 'zod';

/** What the last stop interrupted, counted when it was pressed. */
export const EmergencyStopCounts = z.object({
  runs: z.number().int().min(0),
  reviews: z.number().int().min(0),
  executions: z.number().int().min(0),
});
export type EmergencyStopCounts = z.infer<typeof EmergencyStopCounts>;

/** The switch. `on` with `since` while it holds; `stopped` counts what the press interrupted. */
export const EmergencyStopState = z.object({
  on: z.boolean(),
  since: z.string().optional(),
  stopped: EmergencyStopCounts.optional(),
});
export type EmergencyStopState = z.infer<typeof EmergencyStopState>;

/** The refusal every start and model call gets while the stop is on. */
export const EMERGENCY_STOP_REFUSAL = 'The emergency stop is on. Resume the factory to run agents again.';
