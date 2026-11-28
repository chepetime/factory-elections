import 'server-only';
import { z } from 'zod';
import { backendCall } from '@factory/backend-client';
import { RemoteTicket } from '@factory/core';
import { backendError, type Result } from '@/lib/factory';

// `tickets`: the output read as JSON tickets, when it is; otherwise only the text shows.
const TicketList = z.object({
  configured: z.boolean(),
  text: z.string(),
  tickets: z.array(RemoteTicket).optional(),
});
export type TicketList = z.infer<typeof TicketList>;

export async function listTickets(project: string): Promise<Result<TicketList>> {
  try {
    const response = await backendCall('ListTickets', { project }, 60_000);
    return { ok: true, value: TicketList.parse(JSON.parse(response.json)) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof z.ZodError ? 'The backend returned an invalid ticket list.' : backendError(error),
    };
  }
}
