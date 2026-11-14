// :TaskReadApi: GET /api/projects/{project}/tasks
import { isProjectName, listTasks } from '@/lib/factory';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ project: string }> }) {
  const { project } = await ctx.params;
  if (!isProjectName(project)) return Response.json({ error: 'invalid_project' }, { status: 400 });
  const result = await listTasks(project);
  if (!result.ok) return Response.json({ error: 'task_source_unavailable' }, { status: 503 });
  return Response.json(result.value);
}
