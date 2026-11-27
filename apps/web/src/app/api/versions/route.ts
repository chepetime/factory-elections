// GET /api/versions: the backend's write counter per project and its boot id. Pollers compare it
// and fetch their lists only when it moved (see src/lib/change-gate.ts).
import { backendCall } from '@factory/backend-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return new Response((await backendCall('GetVersions', {}, 2000)).json, {
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return Response.json({ error: 'versions_unavailable' }, { status: 503 });
  }
}
