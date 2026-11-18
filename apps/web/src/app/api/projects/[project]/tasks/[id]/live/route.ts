// Live run output for the task page poll. The page reloads only when `version` changes.
import { isProjectName, isTaskId } from '@/lib/factory';
import { readLiveRun } from '@/lib/live-run';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ project: string; id: string }> }) {
  const { project, id } = await ctx.params;
  if (!isProjectName(project) || !isTaskId(id))
    return Response.json({ error: 'invalid_target' }, { status: 400 });
  const live = await readLiveRun(project, id);
  if (!live) return Response.json({ error: 'task_source_unavailable' }, { status: 503 });
  return Response.json(live, { headers: { 'cache-control': 'no-store' } });
}
