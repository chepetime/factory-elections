// Workspace agents, stored in one document so file mode and Postgres mode both list them.
import { join } from 'node:path';
import { Cause, Effect, Exit } from 'effect';
import { z } from 'zod';
import { AgentId, AgentInput, AgentProfile, AgentRoster, agentSlug } from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';
import { Conflict } from './conflict.ts';

/** Workspace documents live under a dotted folder: project names cannot contain a dot. */
export const WORKSPACE_DIR = '.workspace';

export type AgentDeps = {
  root: string;
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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { items: [] };
      throw error;
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
