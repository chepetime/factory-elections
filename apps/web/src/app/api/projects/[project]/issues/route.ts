// GET /api/projects/{project}/issues: board task summaries for the sidebar.
import { isProjectName } from '@/lib/factory';
import { listIssues } from '@/lib/issues';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ project: string }> }) {
  const { project } = await ctx.params;
  if (!isProjectName(project)) return Response.json({ error: 'invalid_project' }, { status: 400 });
  const result = await listIssues(project);
  if (!result.ok) return Response.json({ error: 'task_source_unavailable' }, { status: 503 });
  return Response.json(
    result.value.items.map((i) => ({
      key: i.key,
      title: i.title,
      status: i.status,
      archived: !!i.archived_at,
      updated_at: i.run?.updated_at && i.run.updated_at > i.updated_at ? i.run.updated_at : i.updated_at,
      run: i.run ? { stage: i.run.stage } : undefined,
    })),
  );
}
