// Chats with workspace agents. Each message is one model turn that resumes the chat's session. The
// agent may read the chat's repository and create board tasks; it never changes files or starts work.
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Cause, Effect, Exit, Semaphore } from 'effect';
import { z } from 'zod';
import {
  AGENT_CHAT_INSTRUCTIONS,
  AgentChat,
  chatToolLine,
  AgentId,
  parseModelRef,
  ProjectName,
  type AgentProfile,
  type ChatTurn,
  type ModelRunner,
  type ToolGuard,
} from '@factory/core';
import type { DataStorage } from '@factory/adapters-data';
import { agentSkills } from './agent-sessions.ts';
import { chatTools } from './agent-tools.ts';
import { WORKSPACE_DIR } from './agent-profiles.ts';
import { Conflict } from '@factory/core';
import { ExecutionRefused, type Executions } from '@factory/dispatcher';
import type { DelegationServer } from './delegation.ts';
import type { AgentBoard } from './ports.ts';

const TURN_BUDGET_USD = 1;
const TURN_TIMEOUT_MS = 10 * 60_000;
const TURN_STALL_MS = 5 * 60_000;

export type ChatSummary = {
  id: string;
  agent: string;
  title: string;
  project?: string;
  last: string;
  working: boolean;
  updated_at: string;
};
const ChatIndex = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        agent: z.string(),
        title: z.string(),
        project: z.string().optional(),
        last: z.string(),
        working: z.boolean(),
        updated_at: z.string(),
      }),
    )
    .default([]),
});

export type ChatDeps = {
  root: string;
  storage: Pick<DataStorage, 'readDocument' | 'writeDocument'>;
  agent: (id: string) => Promise<AgentProfile>;
  projects: () => Promise<{ name: string; repo: string }[]>;
  issues: Pick<AgentBoard, 'create' | 'update' | 'list'>;
  /** Runs a turn; the backend passes a traced runner for chats with a project. */
  runner: (project?: string) => ModelRunner;
  /** Runs each reply: slot, stop, shutdown and finalize. */
  executions: Executions;
  delegation?: Pick<DelegationServer, 'grant'>;
  now?: () => Date;
};

/** The execution key of a chat's reply. */
const chatKey = (id: string) => `chat/${id}`;

const StartInput = z.object({ agent: AgentId, project: ProjectName.optional() });
const SendInput = z.object({ id: z.uuid(), text: z.string().trim().min(1).max(20_000) });
const IdInput = z.object({ id: z.uuid() });
const ListInput = z.object({ agent: AgentId.optional() });

/** Read tools may only look inside the chat's repository, and never at env files. */
export function repositoryReadGuard(repo: string): ToolGuard {
  const root = resolve(repo);
  return {
    check(tool, input) {
      const value = input as Record<string, unknown>;
      const pattern = value.pattern;
      if (typeof pattern === 'string' && tool === 'Glob' && (isAbsolute(pattern) || pattern.includes('..')))
        return 'Glob patterns must stay inside the repository';
      for (const key of ['file_path', 'path', 'notebook_path']) {
        const raw = value[key];
        if (typeof raw !== 'string') continue;
        const target = resolve(root, raw);
        const inside = relative(root, target);
        if (inside.startsWith('..') || isAbsolute(inside)) return `${tool} may only read inside ${root}`;
        if (/(^|\/)\.env(\.|$)/.test(inside) || inside.split('/').includes('.git'))
          return `${tool} may not read ${inside}`;
      }
      return undefined;
    },
  };
}

export class ChatService {
  private readonly lock = Effect.runSync(Semaphore.make(1));
  private readonly deps: ChatDeps;
  /** Reply text so far, per chat, while a turn runs. */
  private readonly partial = new Map<string, string>();
  /** Tool calls so far, per chat, while a turn runs. */
  private readonly steps = new Map<string, NonNullable<ChatTurn['tools']>>();
  constructor(deps: ChatDeps) {
    this.deps = deps;
  }
  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
  private path(id: string): string {
    return join(this.deps.root, WORKSPACE_DIR, 'chats', `${id}.json`);
  }
  private get indexPath(): string {
    return join(this.deps.root, WORKSPACE_DIR, 'chats.json');
  }
  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const exit = await Effect.runPromiseExit(
      this.lock.withPermits(1)(Effect.tryPromise({ try: work, catch: (error) => error })),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  }
  private async index() {
    try {
      return ChatIndex.parse(await this.deps.storage.readDocument(this.indexPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { items: [] };
      throw error;
    }
  }
  private async read(id: string): Promise<AgentChat> {
    try {
      return AgentChat.parse(await this.deps.storage.readDocument(this.path(id)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Conflict('Chat not found');
      throw error;
    }
  }
  /** Writes the chat and its index line. Call under the lock. */
  private async save(chat: AgentChat): Promise<void> {
    await this.deps.storage.writeDocument(this.path(chat.id), chat);
    const index = await this.index();
    const last = chat.turns.at(-1)?.text.replace(/\s+/g, ' ').slice(0, 140) ?? '';
    const line = {
      id: chat.id,
      agent: chat.agent,
      title: chat.title,
      ...(chat.project ? { project: chat.project } : {}),
      last,
      working: chat.working,
      updated_at: chat.updated_at,
    };
    await this.deps.storage.writeDocument(this.indexPath, {
      items: [line, ...index.items.filter((i) => i.id !== chat.id)],
    });
  }

  async list(raw: unknown): Promise<ChatSummary[]> {
    const { agent } = ListInput.parse(raw ?? {});
    const items = (await this.index()).items.filter((i) => !agent || i.agent === agent);
    return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async get(raw: unknown): Promise<AgentChat & { partial?: string; partial_tools?: ChatTurn['tools'] }> {
    const { id } = IdInput.parse(raw);
    const read = await this.read(id);
    // A reply cut off by a backend restart is not running any more.
    const chat = read.working && !this.replying(id) ? { ...read, working: false } : read;
    const partial = this.partial.get(id);
    const steps = this.steps.get(id);
    return {
      ...chat,
      ...(partial ? { partial } : {}),
      ...(steps?.length ? { partial_tools: steps } : {}),
    };
  }

  async start(raw: unknown): Promise<AgentChat> {
    const { agent, project } = StartInput.parse(raw);
    const profile = await this.deps.agent(agent);
    if (profile.archived_at) throw new Conflict(`${profile.name} is archived.`);
    if (project && !(await this.deps.projects()).some((p) => p.name === project))
      throw new Conflict(`No project ${project}`);
    const at = this.now();
    const chat = AgentChat.parse({
      id: randomUUID(),
      agent,
      title: 'New chat',
      ...(project ? { project } : {}),
      created_at: at,
      updated_at: at,
    });
    await this.serial(() => this.save(chat));
    return chat;
  }

  async rename(raw: unknown): Promise<AgentChat> {
    const { id, title } = z.object({ id: z.uuid(), title: z.string().trim().min(1).max(120) }).parse(raw);
    return this.serial(async () => {
      const chat = { ...(await this.read(id)), title, updated_at: this.now() };
      await this.save(chat);
      return chat;
    });
  }

  async remove(raw: unknown): Promise<{ id: string }> {
    const { id } = IdInput.parse(raw);
    if (this.replying(id)) throw new Conflict('Stop the reply first.');
    await this.serial(async () => {
      const index = await this.index();
      await this.deps.storage.writeDocument(this.indexPath, {
        items: index.items.filter((i) => i.id !== id),
      });
    });
    return { id };
  }

  stop(raw: unknown): { stopped: boolean } {
    const { id } = IdInput.parse(raw);
    return { stopped: this.deps.executions.interrupt(chatKey(id)) };
  }

  /**
   * Chats whose stored `working` flag nothing holds: a restart cut the reply. `get` already reads
   * them as idle; this writes it. Returns the chat ids it changed. Nothing is changed when `dry`.
   */
  async clearStaleWorking(dry = false): Promise<{ id: string; updated_at: string }[]> {
    return this.serial(async () => {
      const found: { id: string; updated_at: string }[] = [];
      for (const item of (await this.index().catch(() => ({ items: [] }))).items) {
        if (!item.working || this.replying(item.id)) continue;
        const chat = await this.read(item.id).catch(() => undefined);
        if (!chat?.working) continue;
        found.push({ id: chat.id, updated_at: chat.updated_at });
        if (!dry) await this.save({ ...chat, working: false });
      }
      return found;
    });
  }

  /** Whether the agent is replying in this chat now. */
  private replying(id: string): boolean {
    return this.deps.executions.observe(chatKey(id)) !== undefined;
  }

  /** Adds your message and starts the agent's reply in the background. Poll `get` for it. */
  async send(raw: unknown): Promise<AgentChat> {
    const { id, text } = SendInput.parse(raw);
    let chat!: AgentChat;
    let agent!: AgentProfile;
    try {
      await this.deps.executions.submit({
        key: chatKey(id),
        action: 'reply',
        accept: async () => {
          chat = await this.read(id);
          agent = await this.deps.agent(chat.agent);
          if (agent.archived_at) throw new Conflict(`${agent.name} is archived.`);
          // Chats read the repository; Codex cannot screen those reads, so chats need Claude for now.
          if (parseModelRef(agent.model).provider !== 'claude')
            throw new Conflict(`${agent.name} uses ${agent.model}. Chats need a Claude model for now.`);
          const at = this.now();
          chat = await this.serial(async () => {
            const current = await this.read(id);
            const next: AgentChat = {
              ...current,
              title: current.turns.length ? current.title : text.split('\n')[0]!.slice(0, 80),
              turns: [...current.turns, { at, role: 'user', text }],
              working: true,
              updated_at: at,
            };
            await this.save(next);
            return next;
          });
        },
        work: (signal) => this.turn(chat, agent, text, signal),
        finalize: async () => {
          this.partial.delete(id);
          this.steps.delete(id);
        },
      });
    } catch (error) {
      if (error instanceof ExecutionRefused)
        throw new Conflict(
          /already working/.test(error.message)
            ? 'The agent is still replying. Wait, or stop it.'
            : /slot/.test(error.message)
              ? 'Every agent slot is in use. Try again in a moment.'
              : error.message,
        );
      throw error;
    }
    return chat;
  }

  /** Waits for the chat's reply in progress; for tests and shutdown. */
  async settled(id: string): Promise<void> {
    await this.deps.executions.settled(chatKey(id));
  }

  private async turn(chat: AgentChat, agent: AgentProfile, text: string, signal: AbortSignal): Promise<void> {
    const projects = await this.deps.projects();
    const repo = chat.project ? projects.find((p) => p.name === chat.project)?.repo : undefined;
    const created: { project: string; key: string }[] = [];
    const grant = this.deps.delegation?.grant({
      label: `chat ${agent.id}`,
      cwd: repo ?? this.deps.root,
      access: 'read-only',
      budgetUsd: 0.5,
      signal,
      tools: chatTools({
        issues: this.deps.issues,
        projects: async () => (await this.deps.projects()).map((p) => p.name),
        agent,
        onCreated: (task) => created.push(task),
      }),
    });
    const skills = await agentSkills(agent.skills);
    const systemPrompt = [
      AGENT_CHAT_INSTRUCTIONS,
      `You are ${agent.name}. ${agent.description}`.trim(),
      `Projects in this workspace: ${projects.map((p) => p.name).join(', ') || '(none)'}.`,
      chat.project
        ? `This chat is about the ${chat.project} project; its repository is your working directory.`
        : '',
      agent.instructions.trim() ? `## Notes from your team\n\n${agent.instructions.trim()}` : '',
      skills,
    ]
      .filter(Boolean)
      .join('\n\n');
    let reply: ChatTurn;
    try {
      const result = await this.deps.runner(chat.project).run({
        step: 'chat',
        model: agent.model,
        effort: agent.effort,
        systemPrompt,
        prompt: text,
        tools: repo ? 'read-only' : 'none',
        ...(repo ? { cwd: repo, guard: repositoryReadGuard(repo) } : {}),
        persistSession: true,
        ...(chat.session_id ? { resume: chat.session_id } : {}),
        maxBudgetUsd: TURN_BUDGET_USD,
        timeoutMs: TURN_TIMEOUT_MS,
        stallMs: TURN_STALL_MS,
        maxTurns: 40,
        signal,
        ...(grant ? { mcp: grant.endpoint } : {}),
        onEvent: (event) => {
          if ('sub' in event && event.sub) return;
          if (event.type === 'text')
            this.partial.set(chat.id, `${this.partial.get(chat.id) ?? ''}${event.text}`);
          if (event.type === 'tool')
            this.steps.set(chat.id, [
              ...(this.steps.get(chat.id) ?? []),
              chatToolLine(event.name, event.input, repo),
            ]);
          if (event.type === 'tool-result') {
            const list = this.steps.get(chat.id);
            const last = list?.at(-1);
            if (last && last.ok === undefined) last.ok = event.ok;
          }
        },
      });
      reply = {
        at: this.now(),
        role: 'agent',
        text: result.text.trim(),
        cost_usd: result.costUsd,
        ...(this.steps.get(chat.id)?.length ? { tools: this.steps.get(chat.id) } : {}),
        ...(created.length ? { tasks_created: created } : {}),
      };
      chat = { ...chat, ...(result.sessionId ? { session_id: result.sessionId } : {}) };
    } catch (error) {
      const stopped = signal.aborted
        ? this.deps.executions.observe(chatKey(chat.id))?.stop_reason === 'interrupted'
          ? 'The backend stopped during this reply. Send it again.'
          : 'Stopped by you.'
        : undefined;
      reply = {
        at: this.now(),
        role: 'agent',
        text: this.partial.get(chat.id) ?? '',
        ...(this.steps.get(chat.id)?.length ? { tools: this.steps.get(chat.id) } : {}),
        ...(created.length ? { tasks_created: created } : {}),
        error: stopped ?? (error instanceof Error ? error.message : String(error)),
      };
    } finally {
      grant?.revoke();
    }
    const session = chat.session_id;
    await this.serial(async () => {
      const current = await this.read(chat.id);
      await this.save({
        ...current,
        ...(session ? { session_id: session } : {}),
        turns: [...current.turns, reply],
        working: false,
        updated_at: reply.at,
      });
    });
  }
}
