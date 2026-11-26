// Workspace agents, stored in one document so file mode and Postgres mode both list them.
import { join } from 'node:path';
import { Cause, Effect, Exit } from 'effect';
import { z } from 'zod';
import { AgentId, AgentInput, AgentProfile, AgentRoster, agentSlug } from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';
import { Conflict } from '@factory/core';

/** Workspace documents live under a dotted folder: project names cannot contain a dot. */
export const WORKSPACE_DIR = '.workspace';

/** The agents a new workspace starts with. They are ordinary agents: edit or archive them. */
export const SEED_AGENTS = [
  {
    id: 'devin',
    name: 'Devin',
    avatar: '🐸',
    description:
      'Developer. Takes board tasks, changes the code in a worktree, runs the checks and hands the change to you for review.',
    model: 'claude-sonnet-5-5',
    effort: 'high',
  },
  {
    id: 'mika',
    name: 'Mika',
    avatar: '🦄',
    description:
      'Chief of staff. Turns goals into tasks, keeps the board tidy and answers questions about the work.',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
  },
  {
    id: 'acosta',
    name: 'Acosta',
    avatar: '🧭',
    description:
      'Product manager. Turns ideas into clear tasks with goals, scope and acceptance criteria, and keeps the board pointed at what matters most.',
    model: 'claude-opus-5-5',
    effort: 'high',
    instructions:
      '- Start from the problem and who has it, then the outcome we want.\n- Every task you write has a short title, a why, and acceptance criteria a reviewer can check.\n- Cut scope before adding it. Say what is out of scope.\n- Ask one clear question when the goal is unclear, instead of guessing.',
  },
  {
    id: 'magda',
    name: 'Magda',
    avatar: '🎨',
    description:
      'Designer. Reviews and improves the UI: layout, spacing, type, color, states and accessibility, and makes focused UI changes.',
    model: 'claude-opus-5-5',
    effort: 'high',
    skills: ['emil-design-engineering'],
    instructions:
      '- Follow the existing components and tokens before inventing new ones.\n- Check every state: empty, loading, error, long text, mobile.\n- Keyboard and screen reader access are part of done: focus order, labels, contrast.\n- Keep changes small and say what you changed and why.',
  },
  {
    id: 'sherlock',
    name: 'Sherlock',
    avatar: '🔍',
    description:
      'PR reviewer. Reviews changes like a senior engineer: correctness, spec fit and standards, with every blocking claim backed by evidence.',
    model: 'claude-opus-5-5',
    effort: 'high',
    skills: ['senior-pr-review'],
    instructions:
      '- Rigor scales with risk. Read the code, the callers and the tests, not only the diff.\n- Every blocking finding names the file and line, and why it matters.\n- Separate blocking findings from suggestions and nits.\n- Do not change code when asked for a review; report findings.',
  },
  {
    id: 'lumix',
    name: 'Lumix',
    avatar: '📋',
    description:
      'Project manager. Tracks the board: what is blocked, what waits for review, what slips, and who works on what. Writes short status updates.',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    instructions:
      '- Lead with what needs a person now: blocked tasks, changes waiting for approval, failed runs.\n- Keep status updates short: done, in progress, blocked, next.\n- Point to task keys, not descriptions.\n- Do not start work yourself; suggest who should take it.',
  },
] as const;

export type AgentDeps = {
  root: string;
  /** Start an empty workspace with SEED_AGENTS. */
  seed?: boolean;
  storage: Pick<DataStorage, 'readDocument' | 'writeDocument'>;
  now?: () => Date;
};

const IdInput = z.object({ id: AgentId });
const UpdateInput = AgentInput.extend({ id: AgentId });
const ArchiveInput = z.object({ id: AgentId, archived: z.boolean() });

export class AgentService {
  private readonly lock = Effect.runSync(Effect.makeSemaphore(1));
  private readonly deps: AgentDeps;
  constructor(deps: AgentDeps) {
    this.deps = deps;
  }
  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
  private get path(): string {
    return join(this.deps.root, WORKSPACE_DIR, 'agents.json');
  }
  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const exit = await Effect.runPromiseExit(
      this.lock.withPermits(1)(Effect.tryPromise({ try: work, catch: (error) => error })),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  }
  private async read(): Promise<AgentRoster> {
    try {
      return AgentRoster.parse(await this.deps.storage.readDocument(this.path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (!this.deps.seed) return { items: [] };
      const at = this.now();
      const seeded = {
        items: SEED_AGENTS.map((a) => AgentProfile.parse({ ...a, created_at: at, updated_at: at })),
      };
      // Stored at once, so the seed keeps its dates and a deleted seed never comes back.
      await this.write(seeded);
      return seeded;
    }
  }
  private write(roster: AgentRoster): Promise<void> {
    return this.deps.storage.writeDocument(this.path, roster);
  }

  async list(): Promise<AgentProfile[]> {
    return (await this.read()).items;
  }

  async get(raw: unknown): Promise<AgentProfile> {
    const { id } = IdInput.parse(raw);
    const agent = (await this.read()).items.find((a) => a.id === id);
    if (!agent) throw new Conflict(`Agent ${id} not found`);
    return agent;
  }

  /** The agent, if it exists and is not archived; assignment and runs need one. */
  async active(id: string): Promise<AgentProfile> {
    const agent = await this.get({ id });
    if (agent.archived_at) throw new Conflict(`${agent.name} is archived. Restore it first.`);
    return agent;
  }

  async create(raw: unknown): Promise<AgentProfile> {
    const input = AgentInput.parse(raw);
    if (!input.name) throw new Conflict('Give the agent a name.');
    const name = input.name;
    return this.serial(async () => {
      const roster = await this.read();
      const taken = new Set(roster.items.map((a) => a.id));
      const base = agentSlug(name);
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 36)}-${n}`;
      const at = this.now();
      const agent = AgentProfile.parse({ ...input, name, id, created_at: at, updated_at: at });
      await this.write({ items: [...roster.items, agent] });
      return agent;
    });
  }

  async update(raw: unknown): Promise<AgentProfile> {
    const { id, ...patch } = UpdateInput.parse(raw);
    return this.serial(async () => {
      const roster = await this.read();
      const current = roster.items.find((a) => a.id === id);
      if (!current) throw new Conflict(`Agent ${id} not found`);
      const updated = AgentProfile.parse({ ...current, ...patch, id, updated_at: this.now() });
      await this.write({ items: roster.items.map((a) => (a.id === id ? updated : a)) });
      return updated;
    });
  }

  async archive(raw: unknown): Promise<AgentProfile> {
    const { id, archived } = ArchiveInput.parse(raw);
    return this.serial(async () => {
      const roster = await this.read();
      const current = roster.items.find((a) => a.id === id);
      if (!current) throw new Conflict(`Agent ${id} not found`);
      const { archived_at: _old, ...rest } = current;
      const at = this.now();
      const updated = AgentProfile.parse(
        archived ? { ...rest, archived_at: at, updated_at: at } : { ...rest, updated_at: at },
      );
      await this.write({ items: roster.items.map((a) => (a.id === id ? updated : a)) });
      return updated;
    });
  }
}
