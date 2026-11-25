// Workspace agents: named collaborators that work board tasks in one open session and chat with you.
// "Agent" in the UI; AgentProfile in code, since agents.ts already names the provider contracts.
import { z } from 'zod';
import { ModelRef } from './agents.ts';
import { Effort, ProjectName } from './schemas.ts';

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
