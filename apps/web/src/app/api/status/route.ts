// GET /api/status: runs the settings page's system checks (doctor, engine, project profiles).
import { systemStatus } from '@/lib/status';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await systemStatus());
}
