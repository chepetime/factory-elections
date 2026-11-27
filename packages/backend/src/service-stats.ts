// Agent stats: each agent's runs, outcomes and spend. BackendService.agentStats calls it.
import { taskSpend, envNames } from '@factory/core';
import { availableSkills } from '@factory/agents';
import type { BackendService } from './service.ts';

/** An agent's tasks across projects, its recent runs, and its last 30 days. */
export async function agentStats(s: BackendService, raw: unknown) {
  const agent = await s.agents.get(raw);
  const projects = await s.projects.list();
  const since = Date.now() - 30 * 86_400_000;
  const per = await Promise.all(
    projects.map(async ({ name }) => {
      const [board, tasks] = await Promise.all([s.issues.list(name), s.tasks.list(name)]);
      const owner = new Map(board.items.flatMap((i) => i.runs.map((r) => [r, i] as const)));
      return {
        work: board.items
          .filter((i) => i.assignee === agent.id && !i.archived_at)
          .map((i) => ({
            project: name,
            key: i.key,
            title: i.title,
            status: i.status,
            priority: i.priority,
            updated_at: i.updated_at,
          })),
        runs: tasks
          .filter((t) => t.agent === agent.id)
          .map((t) => ({
            project: name,
            id: t.id,
            stage: t.stage,
            created_at: t.created_at ?? '',
            updated_at: t.updated_at ?? t.created_at ?? '',
            cost_usd: taskSpend(t),
            key: owner.get(t.id)?.key,
            title: owner.get(t.id)?.title ?? t.name ?? t.prompt.split('\n')[0]!.slice(0, 100),
          })),
      };
    }),
  );
  const runs = per.flatMap((p) => p.runs).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const recent = runs.filter((r) => Date.parse(r.updated_at) > since);
  return {
    agent,
    skills_available: await availableSkills(),
    /** Env names the operator lets agents pass; names only, never values. */
    env_allowed: envNames(process.env.FACTORY_AGENT_ENV_ALLOW),
    work: per.flatMap((p) => p.work),
    running: runs.filter((r) => r.stage === 'coding' || r.stage === 'reviewing' || r.stage === 'queued'),
    runs: runs.slice(0, 10),
    last30: {
      runs: recent.length,
      completed: recent.filter(
        (r) => r.stage === 'awaiting-approval' || r.stage === 'approved' || r.stage === 'pr-opened',
      ).length,
      cost_usd: recent.reduce((sum, r) => sum + r.cost_usd, 0),
    },
  };
}
