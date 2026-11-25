// GET /api/projects/{project}/tasks/{run id}/session: the run's session log, polled while it works.
import { isProjectName, isTaskId } from '@/lib/factory';
import { readRunSession } from '@/lib/run-session';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ project: string; id: string }> }) {
  const { project, id } = await ctx.params;
  if (!isProjectName(project) || !isTaskId(id))
    return Response.json({ error: 'invalid_target' }, { status: 400 });
  const session = await readRunSession(project, id);
  if (!session.ok) return Response.json({ error: session.error }, { status: 503 });
  return Response.json(session.value, { headers: { 'cache-control': 'no-store' } });
}
