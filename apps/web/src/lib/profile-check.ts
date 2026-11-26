// Server-only bridge to the backend's profile check ("Check setup").
import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend-client';
import { backendError, type Result } from '@/lib/factory';

const Step = z.object({
  name: z.string(),
  command: z.string().optional(),
  outcome: z.enum(['passed', 'failed', 'skipped']),
  duration_ms: z.number(),
  output: z.string(),
  environment: z.string().optional(),
});
export const ProfileCheckState = z.object({
  running: z.boolean(),
  started_at: z.string().optional(),
  finished_at: z.string().optional(),
  passed: z.boolean().optional(),
  steps: z.array(Step),
  log: z.string().optional(),
  error: z.string().optional(),
});
export type ProfileCheckState = z.infer<typeof ProfileCheckState>;

export async function startProfileCheck(project: string): Promise<Result<ProfileCheckState>> {
  try {
    const { json } = await backendCall('StartProfileCheck', { project, id: '' });
    return { ok: true, value: ProfileCheckState.parse(JSON.parse(json)) };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}

export async function readProfileCheck(project: string): Promise<Result<ProfileCheckState>> {
  try {
    const { json } = await backendCall('GetProfileCheck', { project, id: '' });
    return { ok: true, value: ProfileCheckState.parse(JSON.parse(json)) };
  } catch (error) {
    return { ok: false, error: backendError(error) };
  }
}
