// :ProjectReadApi: GET /api/projects
import { listProjects } from '@/lib/factory';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await listProjects();
  if (!result.ok) return Response.json({ error: 'project_source_unavailable' }, { status: 503 });
  return Response.json(result.value);
}
