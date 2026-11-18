// Repository memory, owned by the backend (see packages/core/src/memory.ts for the rules):
//
//   <root>/<project>/memory/facts.json       facts, with the sessions that confirm them
//   <root>/<project>/memory/sessions.jsonl   one digest per agent session
//   <root>/<project>/memory/state.json       sessions since the last fact review
//   <root>/<project>/memory/tools.json       review-turn tool usage, for pruning
//   <root>/<project>/memory/costs.jsonl      what each fact review cost
//
// Every write goes through this service; agents never edit memory files.
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  applyProposal,
  digestSession,
  Fact,
  FACT_PROPOSAL_SCHEMA,
  FACT_REVIEW_PROMPT,
  FactProposal,
  factsPrompt,
  parseModelRef,
  prunedTools,
  recordToolUse,
  REVIEW_EVERY,
  SessionDigest,
  ToolUsage,
  type AgentEvent,
  type ModelRun,
  type ModelRunner,
} from '@factory/core';
import { writeJsonAtomic } from '@factory/adapters-fs';

export const MEMORY_MODEL = process.env.FACTORY_MEMORY_MODEL ?? 'claude-haiku-5-5';
/** Most one fact review may spend. */
const REVIEW_BUDGET_USD = 0.2;
/** Digests a review reads: the new ones plus a few before them for context. */
const REVIEW_WINDOW = 9;
/** Text that looks like a credential never becomes a fact. */
const SECRET =
  /(sk-[a-z0-9-]{10,}|ghp_[a-z0-9]{20,}|github_pat_|AKIA[0-9A-Z]{16}|xox[bap]-|-----BEGIN|(password|secret|token|api[_-]?key)\s*[=:]\s*\S{6,})/i;

const State = z.object({ pending: z.number().int().nonnegative(), reviewed_at: z.string().optional() });

export interface MemorySnapshot {
  facts: Fact[];
  pruned_tools: string[];
  sessions: number;
  pending: number;
  review_cost_usd: number;
}

export class MemoryService {
  private readonly root: string;
  private readonly runner: (project: string) => ModelRunner;
  private readonly log: (line: string) => void;
  /** One chain per project, so writes and reviews never overlap. */
  private readonly chains = new Map<string, Promise<unknown>>();
  constructor(
    root: string,
    runner: (project: string) => ModelRunner,
    log: (line: string) => void = () => {},
  ) {
    this.root = root;
    this.runner = runner;
    this.log = log;
  }

  private dir(project: string): string {
    return join(this.root, project, 'memory');
  }
  private serial<T>(project: string, work: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(project) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.chains.set(project, next);
    return next;
  }
  /** Resolves when every queued write and review has finished. */
  async idle(): Promise<void> {
    for (;;) {
      const pending = [...this.chains.values()];
      await Promise.allSettled(pending);
      if (pending.every((p, i) => p === [...this.chains.values()][i])) return;
    }
  }

  private async readJson<T>(file: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
    try {
      return schema.parse(JSON.parse(await readFile(join(file), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw error;
    }
  }
  async facts(project: string): Promise<Fact[]> {
    return this.readJson(join(this.dir(project), 'facts.json'), z.array(Fact), []);
  }
  /** The block of confirmed facts for a system prompt. Never fails a session. */
  async prompt(project: string): Promise<string | undefined> {
    return factsPrompt(await this.facts(project).catch(() => []));
  }
  private async digests(project: string): Promise<SessionDigest[]> {
    const text = await readFile(join(this.dir(project), 'sessions.jsonl'), 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        const parsed = SessionDigest.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      });
  }

  /** Records one finished session; every REVIEW_EVERY sessions, reviews the facts. */
  record(project: string, digest: SessionDigest): Promise<void> {
    return this.serial(project, async () => {
      await mkdir(this.dir(project), { recursive: true });
      await appendFile(join(this.dir(project), 'sessions.jsonl'), `${JSON.stringify(digest)}\n`, {
        mode: 0o600,
      });
      const stateFile = join(this.dir(project), 'state.json');
      const state = await this.readJson(stateFile, State, { pending: 0 });
      state.pending++;
      await writeJsonAtomic(stateFile, state);
      if (state.pending >= REVIEW_EVERY)
        await this.reviewNow(project).catch((e: unknown) => this.log(`memory review failed: ${String(e)}`));
    });
  }

  /** Reviews the recent sessions against the facts. Runs inside the project's chain. */
  private async reviewNow(project: string): Promise<void> {
    const stateFile = join(this.dir(project), 'state.json');
    const state = await this.readJson(stateFile, State, { pending: 0 });
    const recent = (await this.digests(project)).slice(-Math.max(REVIEW_WINDOW, state.pending));
    if (!recent.length) return;
    const facts = await this.facts(project);
    const request: ModelRun = {
      step: 'memory',
      model: MEMORY_MODEL,
      effort: 'low',
      tools: 'none',
      systemPrompt: FACT_REVIEW_PROMPT,
      prompt: [
        '<current_facts>',
        JSON.stringify(
          facts
            .filter((f) => f.status !== 'dropped')
            .map(({ id, text, kind, sessions, status }) => ({
              id,
              text,
              kind,
              confirmations: sessions.length,
              status,
            })),
          null,
          1,
        ),
        '</current_facts>',
        '<sessions>',
        ...recent.map((d) => JSON.stringify(d)),
        '</sessions>',
      ].join('\n'),
      outputSchema: FACT_PROPOSAL_SCHEMA,
      maxBudgetUsd: REVIEW_BUDGET_USD,
      timeoutMs: 120_000,
    };
    let cost: number | null = null;
    try {
      const result = await this.runner(project).run(request);
      cost = result.costUsd;
      const proposal = FactProposal.parse(result.structured);
      proposal.facts = proposal.facts.filter((f) => !SECRET.test(f.text));
      const next = applyProposal(
        facts,
        proposal,
        new Set(recent.map((d) => d.id)),
        new Date().toISOString(),
        () => randomUUID().slice(0, 8),
      );
      await writeJsonAtomic(join(this.dir(project), 'facts.json'), next);
      const active = next.filter((f) => f.status === 'active').length;
      this.log(`memory: reviewed ${recent.length} sessions for ${project}; ${active} confirmed fact(s)`);
    } catch (error) {
      cost ??=
        typeof (error as { costUsd?: unknown }).costUsd === 'number'
          ? (error as { costUsd: number }).costUsd
          : null;
      throw error;
    } finally {
      await appendFile(
        join(this.dir(project), 'costs.jsonl'),
        `${JSON.stringify({ at: new Date().toISOString(), cost_usd: cost, sessions: recent.length })}\n`,
        { mode: 0o600 },
      );
      await writeJsonAtomic(stateFile, { pending: 0, reviewed_at: new Date().toISOString() });
    }
  }

  forget(project: string, id: string): Promise<void> {
    return this.serial(project, async () => {
      const facts = await this.facts(project);
      const fact = facts.find((f) => f.id === id);
      if (!fact) throw new Error(`no fact ${id}`);
      fact.status = 'dropped';
      fact.dropped_reason = 'removed by the user';
      fact.updated_at = new Date().toISOString();
      await writeJsonAtomic(join(this.dir(project), 'facts.json'), facts);
    });
  }

  // ---------- tools ----------

  async toolUsage(project: string): Promise<ToolUsage> {
    return this.readJson(join(this.dir(project), 'tools.json'), ToolUsage, {
      sessions: 0,
      known: [],
      last_used: {},
      restored_at: 0,
    });
  }
  async pruned(project: string): Promise<string[]> {
    return prunedTools(
      await this.toolUsage(project).catch(() => ({ sessions: 0, known: [], last_used: {}, restored_at: 0 })),
    );
  }
  recordTools(project: string, offered: readonly string[], used: readonly string[]): Promise<void> {
    return this.serial(project, async () => {
      await mkdir(this.dir(project), { recursive: true });
      await writeJsonAtomic(
        join(this.dir(project), 'tools.json'),
        recordToolUse(await this.toolUsage(project), offered, used),
      );
    });
  }
  restoreTools(project: string): Promise<void> {
    return this.serial(project, async () => {
      const usage = await this.toolUsage(project);
      await mkdir(this.dir(project), { recursive: true });
      await writeJsonAtomic(join(this.dir(project), 'tools.json'), { ...usage, restored_at: usage.sessions });
    });
  }

  async snapshot(project: string): Promise<MemorySnapshot> {
    const [facts, pruned, digests, state, costs] = await Promise.all([
      this.facts(project),
      this.pruned(project),
      this.digests(project),
      this.readJson(join(this.dir(project), 'state.json'), State, { pending: 0 }),
      readFile(join(this.dir(project), 'costs.jsonl'), 'utf8').catch(() => ''),
    ]);
    const review_cost_usd = costs
      .split('\n')
      .filter(Boolean)
      .reduce((sum, line) => sum + (Number((JSON.parse(line) as { cost_usd?: unknown }).cost_usd) || 0), 0);
    return { facts, pruned_tools: pruned, sessions: digests.length, pending: state.pending, review_cost_usd };
  }

  /**
   * Wraps a runner so each tool-using call is recorded as a session of `project`. Calls without
   * tools (classifier, PR writer) teach nothing about the repository and are not recorded.
   */
  recording(project: string, run: string, base: ModelRunner): ModelRunner {
    let n = 0;
    return {
      run: async (request) => {
        if (request.tools === 'none') return base.run(request);
        const events: AgentEvent[] = [];
        const id = `${run}:${request.step ?? 'call'}:${++n}`;
        const at = new Date().toISOString();
        const finish = (ok: boolean, text: string) => {
          const digest = digestSession(
            { id, at, kind: request.step ?? 'call', provider: parseModelRef(request.model).provider },
            [...events, { type: 'result', ok, text }],
          );
          void this.record(project, digest).catch(() => undefined);
        };
        try {
          const result = await base.run({
            ...request,
            onEvent: (event) => {
              if (event.type !== 'result') events.push(event);
              request.onEvent?.(event);
            },
          });
          finish(true, result.text);
          return result;
        } catch (error) {
          finish(false, error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    };
  }
}
