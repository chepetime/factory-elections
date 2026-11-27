// Workspace agents: named collaborators that work board tasks in one open session and chat with you.
// "Agent" in the UI; AgentProfile in code, since agents.ts already names the provider contracts.
import { z } from 'zod';
import { ModelRef } from './agents.ts';
import { runFinished } from './issues.ts';
import { Effort, ProjectName, type Stage } from './schemas.ts';

const Iso = z.string().min(1);

export const AgentId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'use lowercase letters, digits and -, up to 40 characters');
export type AgentId = z.infer<typeof AgentId>;

/** An env var name passed from the backend's environment; the value is never stored. */
const EnvName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'use an env var name such as LINEAR_TOKEN');

export const AgentMcpServer = z.object({
  name: z.string().regex(/^[a-z0-9_-]{1,30}$/, 'use lowercase letters, digits, - and _'),
  url: z.url({ protocol: /^https?$/ }),
  /** The bearer token comes from this backend env var, so no secret is stored. */
  token_env: EnvName.optional(),
});
export type AgentMcpServer = z.infer<typeof AgentMcpServer>;

export const AgentProfile = z.object({
  id: AgentId,
  name: z.string().trim().min(1).max(60),
  /** One emoji or up to two letters. */
  avatar: z.string().trim().min(1).max(8).default('🤖'),
  description: z.string().trim().max(500).default(''),
  model: ModelRef.default('claude-sonnet-5-5'),
  effort: Effort.default('medium'),
  /** Your notes, added after the Factory instructions. Markdown. */
  instructions: z.string().max(20_000).default(''),
  /** Skill names in definitions/skills/. */
  skills: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  mcp: z.array(AgentMcpServer).max(10).default([]),
  pass_env: z.array(EnvName).max(20).default([]),
  /** Runs this agent may work at once. */
  concurrency: z.number().int().min(1).max(5).default(1),
  /** Starts Todo tasks assigned to it on its own when it has a free slot. */
  auto_pickup: z.boolean().default(true),
  /** Spend limit for one task's session, its resumes included. */
  task_budget_usd: z.number().positive().max(100).default(10),
  archived_at: Iso.optional(),
  created_at: Iso,
  updated_at: Iso,
});
export type AgentProfile = z.infer<typeof AgentProfile>;

export const AgentRoster = z.object({ items: z.array(AgentProfile).default([]) });
export type AgentRoster = z.infer<typeof AgentRoster>;

/** Fields a person sets when creating or editing an agent. */
export const AgentInput = AgentProfile.omit({
  id: true,
  archived_at: true,
  created_at: true,
  updated_at: true,
})
  .partial()
  .extend({ name: z.string().trim().min(1).max(60).optional() });
export type AgentInput = z.infer<typeof AgentInput>;

/** `Ada Lovelace` → `ada-lovelace`; empty input gives `agent`. */
export function agentSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'agent';
}

export const ChatTurn = z.object({
  at: Iso,
  role: z.enum(['user', 'agent']),
  text: z.string(),
  cost_usd: z.number().nullable().optional(),
  /** The agent's tool calls during this turn, in order, for the person to follow. */
  tools: z.array(z.object({ name: z.string(), detail: z.string(), ok: z.boolean().optional() })).optional(),
  /** Task keys the agent created during this turn. */
  tasks_created: z.array(z.object({ project: ProjectName, key: z.string() })).optional(),
  error: z.string().optional(),
});
export type ChatTurn = z.infer<typeof ChatTurn>;

export const AgentChat = z.object({
  id: z.uuid(),
  agent: AgentId,
  title: z.string().max(120),
  /** The repository the agent may read in this chat. */
  project: ProjectName.optional(),
  session_id: z.string().optional(),
  turns: z.array(ChatTurn).default([]),
  working: z.boolean().default(false),
  created_at: Iso,
  updated_at: Iso,
});
export type AgentChat = z.infer<typeof AgentChat>;

/** Rules for every agent session on a task. The app keeps them; a person's notes come after them. */
export const AGENT_FACTORY_INSTRUCTIONS = `You are an agent working one board task in a git worktree that Factory made for it.

- Work only inside the current directory. Do not switch branches, reset, or touch other worktrees. You cannot push; a person opens the pull request after approving your change.
- Read the task, plan briefly, then make the change. Keep it focused on the task.
- Run the project's tests before you finish, and fix what fails.
- Commit your work with clear messages. Factory commits anything left when you stop.
- Factory verifies your commits after your turn and refuses the change when:
  - it has more than 400 non-test lines (test files do not count). If the task needs more, do the smallest deployable part, and comment with the rest so a person can file a follow-up task.
  - it weakens tests (removes tests or assertions, or skips them). Fix the code, not the tests.
  - files change after your turn ends. Stop every background process you started before you finish.
- Before you set in_review, commit, then call the check_change tool and fix what it reports.
- Do the task yourself. Use delegate only for a short, independent part that finishes within your turn, never to hand over the whole task.
- When Factory sends you a verification failure, fix it in the same way: new commits, no merge, rebase, pull or reset.
- Use the factory tools:
  - comment: tell the person what you did, what you found, or what you need. Keep it short.
  - set_status: in_review when the change is ready, blocked when you need a person, in_progress while you work.
- If the task is unclear or impossible, comment with the question and set the status to blocked instead of guessing.
- When a person replies on the task, you continue in the same session. Answer their comment first.`;

/** Rules for chats. The agent can read the chat's repository and create tasks; it changes no code. */
export const AGENT_CHAT_INSTRUCTIONS = `You are chatting with a person about their work in Factory.

- You can read the repository of this chat's project, if it has one. You cannot change files.
- Use the factory tools to look at tasks (list_tasks) and to create tasks (create_task). A task you create goes to Todo; it does not start any work.
- Before you create tasks, say what you will create. Write each task with a short title and a description with acceptance criteria.
- Answer briefly and plainly.`;

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low', 'none'] as const;

export type PickupCandidate = {
  project: string;
  key: string;
  assignee?: string;
  status: string;
  priority: (typeof PRIORITY_ORDER)[number];
  created_at: string;
  archived: boolean;
  /** The latest run's stage, if the task has one. */
  run_stage?: Stage;
  /** The latest run exists but never started, so it can start now. */
  restartable?: boolean;
};

/**
 * Which tasks each free agent starts now: Todo tasks assigned to it with no open run, most urgent
 * first, then oldest, up to the agent's free slots. `busy` counts the runs each agent is working.
 */
export function pickupPlan(
  agents: readonly Pick<AgentProfile, 'id' | 'concurrency' | 'auto_pickup' | 'archived_at'>[],
  tasks: readonly PickupCandidate[],
  busy: ReadonlyMap<string, number>,
  skip: (task: PickupCandidate) => boolean = () => false,
): PickupCandidate[] {
  const plan: PickupCandidate[] = [];
  for (const agent of agents) {
    if (!agent.auto_pickup || agent.archived_at) continue;
    const free = agent.concurrency - (busy.get(agent.id) ?? 0);
    if (free <= 0) continue;
    const ready = tasks
      .filter(
        (t) =>
          t.assignee === agent.id &&
          t.status === 'todo' &&
          !t.archived &&
          (t.run_stage === undefined || runFinished(t.run_stage) || t.restartable === true) &&
          !skip(t),
      )
      .sort(
        (a, b) =>
          PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
          a.created_at.localeCompare(b.created_at),
      );
    plan.push(...ready.slice(0, free));
  }
  return plan;
}

export type AccessLevel = 'full' | 'limited' | 'none';
export type ServiceAccess = { service: string; level: AccessLevel; detail: string };

/** Services a person may expect a session to reach, shown even when not connected. */
const OUTSIDE_SERVICES = ['Slack', 'Fathom', 'Confluence', 'Figma', 'Sentry'] as const;

/**
 * What a session on a task can reach. Keep it in line with what the backend grants: the run's
 * tools, its Factory tools (agent-tools.ts) and the sandbox. Outside services are not connected yet.
 */
export function taskAccess(input: { workflow: 'agent' | 'pipeline'; jiraKey?: string }): ServiceAccess[] {
  const agent = input.workflow === 'agent';
  return [
    {
      service: 'Repository',
      level: 'full',
      detail: 'Reads, edits and runs commands in the task worktree, behind the guard and sandbox.',
    },
    agent
      ? { service: 'Task board', level: 'limited', detail: 'Comments on this task and sets its status.' }
      : { service: 'Task board', level: 'none', detail: 'Cannot comment or change status.' },
    {
      service: 'GitHub',
      level: 'none',
      detail: 'Cannot push. You open the pull request after you approve.',
    },
    input.jiraKey
      ? {
          service: 'Jira',
          level: 'limited',
          detail: `Sees the key ${input.jiraKey} in the task text; cannot read the ticket.`,
        }
      : { service: 'Jira', level: 'none', detail: 'Not connected.' },
    {
      service: 'Web',
      level: 'limited',
      detail: 'Only the domains the repo profile allows, such as the package registry.',
    },
    ...OUTSIDE_SERVICES.map((service) => ({ service, level: 'none' as const, detail: 'Not connected.' })),
  ];
}

/** A short, human line for one tool call in a chat: "Read src/app.ts", "Created a task". */
export function chatToolLine(
  name: string,
  input: Record<string, unknown>,
  cwd?: string,
): { name: string; detail: string } {
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const path = (v: unknown) => {
    const p = text(v);
    return cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p;
  };
  const factory = /^mcp__factory__(.+)$/.exec(name)?.[1];
  if (factory === 'create_task') return { name: 'Create task', detail: text(input.title) };
  if (factory === 'list_tasks') return { name: 'List tasks', detail: text(input.project) };
  if (factory === 'delegate') return { name: 'Ask another agent', detail: text(input.task).slice(0, 80) };
  if (name === 'Read') return { name: 'Read', detail: path(input.file_path) };
  if (name === 'Grep') return { name: 'Search', detail: text(input.pattern) };
  if (name === 'Glob') return { name: 'Find files', detail: text(input.pattern) };
  return { name, detail: '' };
}
