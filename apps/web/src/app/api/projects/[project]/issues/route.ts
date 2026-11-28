// GET /api/projects/{project}/issues: board task summaries for the sidebar.
import { isProjectName } from '@/lib/factory';
import { listIssues } from '@/lib/issues';
import { listAgents } from '@/lib/agents';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ project: string }> }) {
  const { project } = await ctx.params;
  if (!isProjectName(project)) return Response.json({ error: 'invalid_project' }, { status: 400 });
  const [result, agentList] = await Promise.all([listIssues(project), listAgents()]);
  const agents = new Map((agentList.ok ? agentList.value : []).map((a) => [a.id, a]));
  if (!result.ok) return Response.json({ error: 'task_source_unavailable' }, { status: 503 });
  return Response.json(
    result.value.items.map((i) => ({
      key: i.key,
      title: i.title,
      status: i.status,
      archived: !!i.archived_at,
      updated_at: i.run?.updated_at && i.run.updated_at > i.updated_at ? i.run.updated_at : i.updated_at,
      run: i.run
        ? {
            stage: i.run.stage,
            ...(i.run.waiting ? { waiting: true } : {}),
            ...(i.run.owned !== undefined ? { owned: i.run.owned } : {}),
          }
        : undefined,
      agent:
        i.assignee && agents.get(i.assignee)
          ? {
              id: i.assignee,
              name: agents.get(i.assignee)!.name,
              avatar: agents.get(i.assignee)!.avatar,
              model: agents.get(i.assignee)!.model,
            }
          : undefined,
    })),
  );
}
