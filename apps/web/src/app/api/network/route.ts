// GET /api/network: the live system map for /network, polled every few seconds.
import { readNetwork } from '@/lib/network';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await readNetwork(), { headers: { 'cache-control': 'no-store' } });
}
