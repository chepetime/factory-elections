// GET /api/emergency-stop: the emergency stop's switch, polled by the app shell.
import { getEmergencyStop } from '@/lib/emergency-stop';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getEmergencyStop();
  if (!state.ok) return Response.json({ error: state.error }, { status: 502 });
  return Response.json(state.value);
}
