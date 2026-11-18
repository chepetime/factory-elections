// Features: the five-step way of working above single tasks.
//
//   grill  -> an agent asks one question at a time, each with its recommendation; decisions are kept
//   spec   -> spec.md: problem, solution, why, context, user stories, notes, acceptance checks; a
//             second agent critiques it; a human approves it
//   board  -> tickets with blocking links, each small enough to stay in the smart zone; a human
//             approves the board (optionally mirrored to the task manager)
//   implement -> every ticket whose blockers are done becomes a factory task (coder, verification,
//             reviewer, approval gate); a ticket with one blocker stacks on the blocker's branch
//   qa     -> a QA plan for the human, from the spec, the changes and the runtime checks
//
// This module is pure: schemas, board rules and prompts. The backend owns the files and the runs.
import { z } from 'zod';
import type { Stage } from './schemas.ts';

export const FeatureId = z.string().regex(/^[a-z0-9][a-z0-9-]{2,40}$/);

export const FeatureStage = z.enum([
  'grilling',
  'spec',
  'spec-approved',
  'board',
  'implementing',
  'qa',
  'done',
  'cancelled',
]);
export type FeatureStage = z.infer<typeof FeatureStage>;

export const TicketState = z.enum([
  /** Blockers are not done. */
  'waiting',
  /** Several blockers: their PRs must merge into the base before this ticket can start. */
  'waiting-merge',
  'running',
  /** Its task reached the approval gate (or later). */
  'done',
  'failed',
]);
export type TicketState = z.infer<typeof TicketState>;

export const Ticket = z.object({
  id: z.string().regex(/^T\d{1,3}$/),
  title: z.string().min(3).max(120),
  /** What to build, with the context a coder needs without reading the whole spec. */
  description: z.string().min(1).max(8000),
  acceptance: z.array(z.string().min(1).max(500)).min(1).max(20),
  blocked_by: z.array(z.string()).default([]),
  /** Small enough for one coder session in the smart zone. */
  size: z.enum(['S', 'M', 'L']),
  state: TicketState.default('waiting'),
  task_id: z.string().optional(),
  /** The task-manager ticket this mirrors, when the board was mirrored. */
  external: z.object({ key: z.string(), url: z.string().optional() }).optional(),
  error: z.string().optional(),
  /** When the factory started a senior-pr-review of this ticket's PR. */
  senior_review_at: z.string().optional(),
  /** Set by the human when every blocker's PR has merged into the base branch. */
  blockers_merged_at: z.string().optional(),
});
export type Ticket = z.infer<typeof Ticket>;

export const GrillTurn = z.object({
  at: z.string(),
  role: z.enum(['user', 'agent']),
  text: z.string(),
  cost_usd: z.number().nullable().optional(),
});
export type GrillTurn = z.infer<typeof GrillTurn>;

export const Feature = z.object({
  id: FeatureId,
  project: z.string(),
  title: z.string().min(1).max(120),
  idea: z.string().min(1).max(50_000),
  stage: FeatureStage,
  created_at: z.string(),
  updated_at: z.string(),
  grill: z.object({ session_id: z.string().optional(), turns: z.array(GrillTurn) }).default({ turns: [] }),
  /** Decisions the grilling settled, in order. */
  decisions: z.array(z.string()).default([]),
  spec: z
    .object({ written_at: z.string(), approved_at: z.string().optional(), critique: z.string().optional() })
    .optional(),
  tickets: z.array(Ticket).default([]),
  board_approved_at: z.string().optional(),
  qa: z.object({ written_at: z.string() }).optional(),
  /** The agent step now running for this feature, if any. */
  working: z.object({ action: z.string(), started_at: z.string() }).optional(),
  /** Why the last agent step failed. */
  error: z.string().optional(),
  cost_usd: z.number().default(0),
});
export type Feature = z.infer<typeof Feature>;

/** Problems with a board: unknown blockers, self-blocks, cycles and duplicate ids. Empty when valid. */
export function boardProblems(tickets: readonly Pick<Ticket, 'id' | 'blocked_by'>[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const t of tickets) {
    if (ids.has(t.id)) problems.push(`${t.id} appears twice`);
    ids.add(t.id);
  }
  for (const t of tickets)
    for (const b of t.blocked_by) {
      if (b === t.id) problems.push(`${t.id} blocks itself`);
      else if (!ids.has(b)) problems.push(`${t.id} is blocked by unknown ticket ${b}`);
    }
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      problems.push(`blocking cycle: ${[...path.slice(path.indexOf(id)), id].join(' → ')}`);
      return;
    }
    state.set(id, 'visiting');
    for (const b of byId.get(id)?.blocked_by ?? []) if (b !== id && byId.has(b)) visit(b, [...path, id]);
    state.set(id, 'done');
  };
  for (const t of tickets) visit(t.id, []);
  return [...new Set(problems)];
}

/** Task stages at which a ticket's work is done for the board: it waits for (or passed) the human gate. */
export const TICKET_DONE_STAGES: readonly Stage[] = ['awaiting-approval', 'approved', 'pr-opened'];
export const TICKET_FAILED_STAGES: readonly Stage[] = ['failed', 'blocked', 'rejected'];

export interface TicketStart {
  ticket: Ticket;
  /** The task branch to stack on: set when the ticket has exactly one blocker. */
  stackOn?: string;
}

/**
 * Which tickets can start now. A ticket starts when every blocker is done. With one blocker it
 * stacks on that blocker's branch; with several it waits until their PRs are merged (the human
 * marks it), because one branch cannot hold several unmerged branches without a merge step.
 */
export function startableTickets(
  feature: Pick<Feature, 'tickets'>,
  branchOf: (taskId: string) => string | undefined,
): TicketStart[] {
  const byId = new Map(feature.tickets.map((t) => [t.id, t]));
  const out: TicketStart[] = [];
  for (const t of feature.tickets) {
    if (t.task_id || (t.state !== 'waiting' && t.state !== 'waiting-merge')) continue;
    const blockers = t.blocked_by.map((b) => byId.get(b)!);
    if (blockers.some((b) => b.state !== 'done')) continue;
    if (blockers.length === 0) out.push({ ticket: t });
    else if (blockers.length === 1) {
      const branch = blockers[0]!.task_id && branchOf(blockers[0]!.task_id);
      if (branch) out.push({ ticket: t, stackOn: branch });
    } else if (t.blockers_merged_at) out.push({ ticket: t });
  }
  return out;
}

/** The task prompt for a ticket: the ticket itself, then the spec as reference. */
export function ticketPrompt(feature: Pick<Feature, 'title'>, ticket: Ticket, spec: string): string {
  return [
    `${ticket.title}`,
    '',
    `Ticket ${ticket.id} of the feature "${feature.title}".`,
    '',
    ticket.description,
    '',
    'Acceptance checks:',
    ...ticket.acceptance.map((a) => `- ${a}`),
    '',
    'Do only this ticket. Other tickets of the feature build the rest.',
    '',
    '<spec>',
    spec.length > 30_000 ? `${spec.slice(0, 30_000)}\n… (truncated; read the spec file for the rest)` : spec,
    '</spec>',
  ].join('\n');
}

export const PlannedTickets = z.object({
  tickets: z
    .array(
      Ticket.pick({
        id: true,
        title: true,
        description: true,
        acceptance: true,
        blocked_by: true,
        size: true,
      }),
    )
    .min(1)
    .max(40),
});
export type PlannedTickets = z.infer<typeof PlannedTickets>;

export const PLANNED_TICKETS_SCHEMA = (() => {
  const { $schema: _, ...schema } = z.toJSONSchema(PlannedTickets, { io: 'input', target: 'draft-7' });
  return schema as Record<string, unknown>;
})();

export const GrillReply = z.object({
  /** The agent's message: one question with its recommendation, or a summary when done. */
  message: z.string().min(1),
  /** Decisions this reply settles from the user's last answer. */
  decisions: z.array(z.string()),
  /** True when the agent has no open question left. */
  done: z.boolean(),
});
export type GrillReply = z.infer<typeof GrillReply>;

export const GRILL_REPLY_SCHEMA = (() => {
  const { $schema: _, ...schema } = z.toJSONSchema(GrillReply, { io: 'input', target: 'draft-7' });
  return schema as Record<string, unknown>;
})();
