// GET /api/inbox: what waits for a person, for the browser notifier.
import { getInbox } from '@/lib/inbox';
import { withTaskKeys } from '@/lib/issues';

export const dynamic = 'force-dynamic';

export async function GET() {
  const inbox = await getInbox();
  if (!inbox.ok) return Response.json({ error: 'Inbox unavailable' }, { status: 502 });
  return Response.json({ items: await withTaskKeys(inbox.value.items) });
}
