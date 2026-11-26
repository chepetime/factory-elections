// Server-only: a task's session log (agent messages, tool calls and results) from the backend.
import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend-client';
import { backendError, type Result } from '@/lib/factory';

const Entry = z.discriminatedUnion('kind', [
  z.object({ at: z.string(), kind: z.literal('run'), text: z.string() }),
  z.object({
    at: z.string(),
    kind: z.literal('text'),
    text: z.string(),
    step: z.string().optional(),
    sub: z.boolean().optional(),
  }),
  z.object({
    at: z.string(),
    kind: z.literal('tool'),
    tool: z.string(),
    input: z.string(),
    call: z.string().optional(),
    step: z.string().optional(),
    sub: z.boolean().optional(),
  }),
  z.object({
    at: z.string(),
    kind: z.literal('result'),
    ok: z.boolean(),
    text: z.string(),
    call: z.string().optional(),
    sub: z.boolean().optional(),
  }),
]);
export type SessionEntry = z.infer<typeof Entry>;
const Session = z.object({ entries: z.array(Entry), live: z.boolean() });
export type RunSession = z.infer<typeof Session>;

export async function readRunSession(project: string, id: string): Promise<Result<RunSession>> {
  try {
    return {
      ok: true,
      value: Session.parse(JSON.parse((await backendCall('GetRunSession', { project, id })).json)),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof z.ZodError ? 'The backend returned an invalid session.' : backendError(error),
    };
  }
}
