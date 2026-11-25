// GET /api/chats/{id}: one chat, polled while the agent replies.
import { getChat } from '@/lib/agents';

export const dynamic = 'force-dynamic';
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!CHAT_ID.test(id)) return Response.json({ error: 'invalid_chat' }, { status: 400 });
  const result = await getChat(id);
  if (!result.ok) return Response.json({ error: result.error }, { status: 503 });
  return Response.json(result.value);
}
