// :ReviewReadApi: GET /api/projects/{project}/reviews/{number} — state and recent activity of a PR review.
import { isProjectName } from '@/lib/factory';
import { reviewDetail } from '@/lib/reviews';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ project: string; number: string }> }) {
  const { project, number } = await ctx.params;
  const n = Number(number);
  if (!isProjectName(project) || !/^\d+$/.test(number) || n < 1)
    return Response.json({ error: 'invalid_target' }, { status: 400 });
  const result = await reviewDetail(project, n);
  if (!result.ok) return Response.json({ error: result.error }, { status: 503 });
  return Response.json(result.value);
}
