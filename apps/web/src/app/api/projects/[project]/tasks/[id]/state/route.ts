// Read-only action discovery; executing commands still requires the local backend.
import { isProjectName, isTaskId, readTaskControls } from '@/lib/factory';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ project: string; id: string }> }) {
  const { project, id } = await ctx.params;
  if (!isProjectName(project) || !isTaskId(id))
    return Response.json({ error: 'invalid_target' }, { status: 400 });
  const result = await readTaskControls(project, id);
  if (!result.ok) return Response.json({ error: 'task_source_unavailable' }, { status: 503 });
  return Response.json(result.value);
}
