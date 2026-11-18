// Features: grill → spec → board → implement → QA (rules in packages/core/src/features.ts).
//
//   <root>/<project>/features/<id>/feature.json   stage, grill chat, decisions, tickets, costs
//   <root>/<project>/features/<id>/spec.md        the spec (agent-written, human-editable)
//   <root>/<project>/features/<id>/critique.md    the second agent's critique of the spec
//   <root>/<project>/features/<id>/qa.md          the QA plan for the human
//
// Agent steps (a grill turn, the spec, the critique, the board, the QA plan) are accepted at once and
// run in the background with an agent slot; `working` and `error` on the feature show their state.
// Implementation reuses the task pipeline: each startable ticket becomes a task run.
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  boardProblems,
  Feature,
  FeatureId,
  GRILL_REPLY_SCHEMA,
  GrillReply,
  PLANNED_TICKETS_SCHEMA,
  PlannedTickets,
  ProjectName,
  startableTickets,
  Ticket,
  TICKET_DONE_STAGES,
  TICKET_FAILED_STAGES,
  ticketPrompt,
  type ModelRun,
  type ModelRunner,
  type ProjectSettings,
  type TaskRecord,
} from '@factory/core';
import { type ProjectStore, writeJsonAtomic } from '@factory/adapters-fs';
import { runShell } from '@factory/adapters-process';
import { Conflict } from './conflict.ts';

const DEFINITIONS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'definitions',
  'features',
);
/** The model for feature steps; the critique uses a second provider when one is configured. */
export const FEATURE_MODEL = process.env.FACTORY_FEATURE_MODEL ?? 'claude-opus-5-5';
export const CRITIQUE_MODEL = process.env.FACTORY_CRITIQUE_MODEL ?? 'claude-sonnet-5-5';
const STEP_BUDGET_USD = 3;
const STEP_TIMEOUT_MS = 30 * 60_000;
const TICK_MS = 20_000;

/** Repository skills that refine a step's method, first match wins. */
const REPO_SKILLS: Record<StepName, string[]> = {
  grill: ['grill-with-docs', 'grill-me', 'grilling'],
  spec: ['write-spec', 'spec'],
  critique: ['spec-critique'],
  tickets: ['create-tickets', 'to-issues', 'split-tickets'],
  qa: ['test-plan', 'qa-plan'],
};
type StepName = 'grill' | 'spec' | 'critique' | 'tickets' | 'qa';

export interface FeatureDeps {
  root: string;
  projects: ProjectStore;
  /** The runner for a project's feature steps (recorded in that project's memory). */
  runner(project: string): ModelRunner;
  /** Takes an agent slot at once, or undefined when every slot is busy. */
  slot(): Promise<(() => void) | undefined>;
  settings(project: string): Promise<ProjectSettings>;
  facts(project: string): Promise<string | undefined>;
  tasks: {
    create(project: string, repo: string, prompt: string, now: string): Promise<TaskRecord>;
    read(project: string, id: string): Promise<TaskRecord>;
    write(task: TaskRecord): Promise<void>;
  };
  /** Schedules a task run (queued behind the worker limit). */
  startRun(project: string, id: string): Promise<unknown>;
  /** Starts a senior-pr-review of an opened PR. */
  reviewPr?(project: string, number: number): Promise<unknown>;
  log?(line: string): void;
}

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('grill'), text: z.string().trim().max(50_000).optional() }),
  z.object({ action: z.literal('skip-grill') }),
  z.object({ action: z.literal('write-spec') }),
  z.object({ action: z.literal('save-spec'), text: z.string().min(1).max(200_000) }),
  z.object({ action: z.literal('approve-spec') }),
  z.object({ action: z.literal('plan') }),
  z.object({
    action: z.literal('save-board'),
    tickets: z
      .array(Ticket.partial({ state: true }))
      .min(1)
      .max(40),
  }),
  z.object({ action: z.literal('approve-board'), mirror: z.boolean().default(false) }),
  z.object({ action: z.literal('mark-merged'), ticket: z.string() }),
  z.object({ action: z.literal('retry-ticket'), ticket: z.string() }),
  z.object({ action: z.literal('write-qa') }),
  z.object({ action: z.literal('complete') }),
  z.object({ action: z.literal('cancel') }),
]);
export type FeatureAction = z.input<typeof Action>;

const strip = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const now = () => new Date().toISOString();

export class FeatureService {
  private readonly deps: FeatureDeps;
  /** Features whose agent step is running in this process. */
  private readonly busy = new Set<string>();
  private readonly steps = new Set<Promise<void>>();
  private ticker?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  constructor(deps: FeatureDeps) {
    this.deps = deps;
  }

  // ---------- files ----------

  private dir(project: string, id: string): string {
    return join(this.deps.root, project, 'features', id);
  }
  async read(project: string, id: string): Promise<Feature> {
    try {
      return Feature.parse(JSON.parse(await readFile(join(this.dir(project, id), 'feature.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Conflict(`no feature ${id}`);
      throw error;
    }
  }
  private async write(feature: Feature): Promise<Feature> {
    const next = { ...feature, updated_at: now() };
    await mkdir(this.dir(feature.project, feature.id), { recursive: true });
    await writeJsonAtomic(join(this.dir(feature.project, feature.id), 'feature.json'), next);
    return next;
  }
  private async text(project: string, id: string, file: string): Promise<string | undefined> {
    return readFile(join(this.dir(project, id), file), 'utf8').catch(() => undefined);
  }

  async list(rawProject: unknown) {
    const project = ProjectName.parse(rawProject);
    const ids = await readdir(join(this.deps.root, project, 'features')).catch(() => [] as string[]);
    const features = await Promise.all(ids.map((id) => this.read(project, id).catch(() => undefined)));
    return features
      .filter((f): f is Feature => f !== undefined)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(({ grill, ...f }) => ({ ...f, grill_turns: grill.turns.length, tickets: f.tickets.length }));
  }
  async detail(raw: unknown) {
    const { project, id } = z.object({ project: ProjectName, id: FeatureId }).parse(raw);
    const feature = await this.read(project, id);
    const [spec, critique, qa] = await Promise.all([
      this.text(project, id, 'spec.md'),
      this.text(project, id, 'critique.md'),
      this.text(project, id, 'qa.md'),
    ]);
    return {
      ...feature,
      spec,
      critique,
      qa,
      working: this.busy.has(`${project}/${id}`) ? feature.working : undefined,
    };
  }

  async create(raw: unknown): Promise<Feature> {
    const { project, idea, title } = z
      .object({
        project: ProjectName,
        idea: z.string().trim().min(1).max(50_000),
        title: z.string().trim().max(120).optional(),
      })
      .parse(raw);
    await this.deps.projects.read(project);
    const name = title || idea.split('\n')[0]!.slice(0, 80);
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'feature';
    const feature: Feature = Feature.parse({
      id: `${slug}-${randomBytes(2).toString('hex')}`,
      project,
      title: name,
      idea,
      stage: 'grilling',
      created_at: now(),
      updated_at: now(),
    });
    return this.write(feature);
  }

  // ---------- actions ----------

  async act(raw: unknown): Promise<Feature> {
    const base = z.object({ project: ProjectName, id: FeatureId }).passthrough().parse(raw);
    const action = Action.parse(raw);
    const { project, id } = base;
    let feature = await this.read(project, id);
    const key = `${project}/${id}`;
    if (this.busy.has(key) && action.action !== 'cancel')
      throw new Conflict('An agent step is running for this feature; wait for it');
    const expect = (...stages: Feature['stage'][]) => {
      if (!stages.includes(feature.stage))
        throw new Conflict(
          `"${action.action}" needs the feature in ${stages.join(' or ')}; it is ${feature.stage}`,
        );
    };
    switch (action.action) {
      case 'grill':
        expect('grilling');
        if (feature.grill.turns.length && !action.text) throw new Conflict('Answer the question first');
        return this.background(feature, 'grill', () => this.grillTurn(project, id, action.text));
      case 'skip-grill':
        expect('grilling');
        return this.write({ ...feature, stage: 'spec' });
      case 'write-spec':
        expect('grilling', 'spec');
        return this.background(feature, 'write-spec', () => this.writeSpec(project, id));
      case 'save-spec':
        expect('spec', 'spec-approved');
        await writeFile(join(this.dir(project, id), 'spec.md'), action.text);
        return this.write({
          ...feature,
          stage: 'spec',
          spec: { written_at: now(), critique: feature.spec?.critique },
        });
      case 'approve-spec':
        expect('spec');
        if (!(await this.text(project, id, 'spec.md'))) throw new Conflict('Write the spec first');
        return this.write({
          ...feature,
          stage: 'spec-approved',
          spec: { ...feature.spec!, approved_at: now() },
        });
      case 'plan':
        expect('spec-approved', 'board');
        return this.background(feature, 'plan', () => this.plan(project, id));
      case 'save-board': {
        expect('board');
        const tickets = action.tickets.map((t) => Ticket.parse({ ...t, state: 'waiting' }));
        const problems = boardProblems(tickets);
        if (problems.length) throw new Conflict(`The board is not valid: ${problems.join('; ')}`);
        return this.write({ ...feature, tickets });
      }
      case 'approve-board':
        expect('board');
        if (!feature.tickets.length) throw new Conflict('Plan the tickets first');
        if (action.mirror) feature = await this.mirror(feature);
        feature = await this.write({ ...feature, stage: 'implementing', board_approved_at: now() });
        void this.tick().catch(() => undefined);
        return feature;
      case 'mark-merged': {
        expect('implementing');
        const tickets = feature.tickets.map((t) =>
          t.id === action.ticket ? { ...t, blockers_merged_at: now() } : t,
        );
        feature = await this.write({ ...feature, tickets });
        void this.tick().catch(() => undefined);
        return feature;
      }
      case 'retry-ticket': {
        expect('implementing');
        const ticket = feature.tickets.find((t) => t.id === action.ticket);
        if (!ticket?.task_id || ticket.state !== 'failed')
          throw new Conflict('Only a failed ticket can be retried');
        await this.deps.startRun(project, ticket.task_id);
        return this.write({
          ...feature,
          tickets: feature.tickets.map((t) =>
            t.id === ticket.id ? { ...t, state: 'running', error: undefined } : t,
          ),
        });
      }
      case 'write-qa':
        expect('implementing', 'qa');
        return this.background(feature, 'write-qa', () => this.writeQa(project, id));
      case 'complete':
        expect('qa');
        return this.write({ ...feature, stage: 'done' });
      case 'cancel':
        return this.write({ ...feature, stage: 'cancelled' });
    }
  }

  /** Accepts an agent step and runs it in the background with an agent slot. */
  private async background(feature: Feature, action: string, work: () => Promise<void>): Promise<Feature> {
    const key = `${feature.project}/${feature.id}`;
    const release = await this.deps.slot();
    if (!release) throw new Conflict('Every agent slot is in use; try again when one finishes');
    this.busy.add(key);
    const accepted = await this.write({
      ...feature,
      working: { action, started_at: now() },
      error: undefined,
    });
    const step: Promise<void> = work()
      .catch(async (error: unknown) => {
        const latest = await this.read(feature.project, feature.id);
        await this.write({ ...latest, error: error instanceof Error ? error.message : String(error) });
      })
      .finally(async () => {
        this.busy.delete(key);
        release();
        const latest = await this.read(feature.project, feature.id).catch(() => undefined);
        if (latest) await this.write({ ...latest, working: undefined });
        this.steps.delete(step);
      });
    this.steps.add(step);
    return accepted;
  }
  /** Resolves when every background step has finished. */
  async idle(): Promise<void> {
    while (this.steps.size) await Promise.allSettled(this.steps);
  }

  /** The step's instructions: the bundled contract, the repository's own skill, and confirmed facts. */
  private async instructions(project: string, step: StepName): Promise<string> {
    const parts = [await readFile(join(DEFINITIONS, `${step}.md`), 'utf8')];
    const { repo } = await this.deps.projects.read(project);
    for (const name of REPO_SKILLS[step]) {
      for (const dir of ['.agents/skills', '.claude/skills']) {
        const text = await readFile(join(repo, dir, name, 'SKILL.md'), 'utf8').catch(() => undefined);
        if (text) {
          parts.push(
            `## The repository's own method (${dir}/${name}/SKILL.md)\n\nFollow it where it does not conflict with the output contract above.\n\n${strip(text)}`,
          );
          break;
        }
      }
      if (parts.length > 1) break;
    }
    const facts = await this.deps.facts(project);
    if (facts) parts.push(facts);
    return parts.join('\n\n');
  }

  private async call(project: string, step: StepName, request: Partial<ModelRun> & Pick<ModelRun, 'prompt'>) {
    const { repo } = await this.deps.projects.read(project);
    return this.deps.runner(project).run({
      step: `feature:${step}`,
      model: FEATURE_MODEL,
      effort: 'high',
      tools: 'read-only',
      cwd: repo,
      systemPrompt: await this.instructions(project, step),
      maxBudgetUsd: STEP_BUDGET_USD,
      timeoutMs: STEP_TIMEOUT_MS,
      stallMs: 10 * 60_000,
      maxTurns: 80,
      loopGuard: true,
      ...request,
    });
  }

  private async addCost(
    project: string,
    id: string,
    cost: number | null,
    change: (f: Feature) => Feature = (f) => f,
  ) {
    const latest = await this.read(project, id);
    return this.write(change({ ...latest, cost_usd: latest.cost_usd + (cost ?? 0) }));
  }

  private async grillTurn(project: string, id: string, answer: string | undefined): Promise<void> {
    let feature = await this.read(project, id);
    const first = feature.grill.turns.length === 0;
    if (answer)
      feature = await this.write({
        ...feature,
        grill: {
          ...feature.grill,
          turns: [...feature.grill.turns, { at: now(), role: 'user', text: answer }],
        },
      });
    const prompt = first
      ? [
          'The idea to grill, as the developer wrote it:',
          '<idea>',
          feature.idea,
          '</idea>',
          answer ? `\nTheir first note: ${answer}` : '',
          '\nAsk your first question.',
        ].join('\n')
      : `The developer answered:\n<answer>\n${answer}\n</answer>`;
    const result = await this.call(project, 'grill', {
      prompt,
      outputSchema: GRILL_REPLY_SCHEMA,
      persistSession: true,
      ...(feature.grill.session_id ? { resume: feature.grill.session_id } : {}),
      maxBudgetUsd: 1,
    });
    const reply = GrillReply.parse(result.structured);
    await this.addCost(project, id, result.costUsd, (f) => ({
      ...f,
      grill: {
        session_id: result.sessionId ?? f.grill.session_id,
        turns: [
          ...f.grill.turns,
          { at: now(), role: 'agent', text: reply.message, cost_usd: result.costUsd },
        ],
      },
      decisions: [...f.decisions, ...reply.decisions],
      stage: reply.done ? 'spec' : f.stage,
    }));
  }

  private async writeSpec(project: string, id: string): Promise<void> {
    const feature = await this.read(project, id);
    const transcript = feature.grill.turns
      .map((t) => `${t.role === 'user' ? 'Developer' : 'Agent'}: ${t.text}`)
      .join('\n\n');
    const spec = await this.call(project, 'spec', {
      prompt: [
        `Feature: ${feature.title}`,
        '<idea>',
        feature.idea,
        '</idea>',
        '<decisions>',
        ...feature.decisions.map((d) => `- ${d}`),
        '</decisions>',
        ...(transcript ? ['<grill_transcript>', transcript, '</grill_transcript>'] : []),
      ].join('\n'),
    });
    await writeFile(join(this.dir(project, id), 'spec.md'), spec.text.trim() + '\n');
    let critique: string | undefined;
    let critiqueCost: number | null = null;
    try {
      // A second model reads the spec as its builder and verifier would.
      const result = await this.call(project, 'critique', {
        model: CRITIQUE_MODEL,
        effort: 'medium',
        prompt: `<spec>\n${spec.text}\n</spec>`,
      });
      critique = result.text.trim();
      critiqueCost = result.costUsd;
      await writeFile(join(this.dir(project, id), 'critique.md'), critique + '\n');
    } catch (error) {
      this.deps.log?.(`feature ${id}: critique failed: ${String(error)}`);
    }
    await this.addCost(project, id, (spec.costUsd ?? 0) + (critiqueCost ?? 0), (f) => ({
      ...f,
      stage: 'spec',
      spec: { written_at: now(), ...(critique ? { critique: 'critique.md' } : {}) },
    }));
  }

  private async plan(project: string, id: string): Promise<void> {
    const spec = (await this.text(project, id, 'spec.md')) ?? '';
    const critique = await this.text(project, id, 'critique.md');
    const result = await this.call(project, 'tickets', {
      prompt: ['<spec>', spec, '</spec>', ...(critique ? ['<critique>', critique, '</critique>'] : [])].join(
        '\n',
      ),
      outputSchema: PLANNED_TICKETS_SCHEMA,
    });
    const planned = PlannedTickets.parse(result.structured);
    const tickets = planned.tickets.map((t) => Ticket.parse({ ...t, state: 'waiting' }));
    const problems = boardProblems(tickets);
    if (problems.length) throw new Error(`The planner returned an invalid board: ${problems.join('; ')}`);
    await this.addCost(project, id, result.costUsd, (f) => ({ ...f, tickets, stage: 'board' }));
  }

  private async writeQa(project: string, id: string): Promise<void> {
    const feature = await this.read(project, id);
    const spec = (await this.text(project, id, 'spec.md')) ?? '';
    const lines: string[] = [];
    for (const t of feature.tickets) {
      const task = t.task_id
        ? await this.deps.tasks.read(project, t.task_id).catch(() => undefined)
        : undefined;
      lines.push(
        `- ${t.id} ${t.title}: ${t.state}${task?.pr ? `, PR ${task.pr.url}` : ''}${task?.worktree ? `, branch ${task.worktree.branch}` : ''}` +
          `${task?.verification ? `, verification ${task.verification.passed ? 'passed' : 'failed'}${task.verification.runtime ? `, runtime check ${task.verification.runtime}` : ''}` : ''}` +
          `${task?.review ? `, reviewer ${task.review.verdict}` : ''}`,
      );
    }
    const result = await this.call(project, 'qa', {
      prompt: [
        '<spec>',
        spec,
        '</spec>',
        '<tickets>',
        ...lines,
        '</tickets>',
        'Read the ticket branches with git to see the changes.',
      ].join('\n'),
    });
    await writeFile(join(this.dir(project, id), 'qa.md'), result.text.trim() + '\n');
    await this.addCost(project, id, result.costUsd, (f) => ({
      ...f,
      stage: 'qa',
      qa: { written_at: now() },
    }));
  }

  /** Creates each ticket in the task manager with the project's create_ticket command. */
  private async mirror(feature: Feature): Promise<Feature> {
    const settings = await this.deps.settings(feature.project);
    const template = settings.task_manager.create_ticket?.trim();
    if (!template) throw new Conflict('The project has no "create a ticket" command in its settings');
    const { repo } = await this.deps.projects.read(feature.project);
    // Values reach the command as environment variables, so no ticket text is parsed by the shell.
    const command = template
      .replace(/(["'])\{summary\}\1|\{summary\}/g, '"$FACTORY_SUMMARY"')
      .replace(/(["'])\{description\}\1|\{description\}/g, '"$FACTORY_DESCRIPTION"');
    const tickets: Ticket[] = [];
    for (const t of feature.tickets) {
      if (t.external) {
        tickets.push(t);
        continue;
      }
      const description = [
        t.description,
        '',
        'Acceptance checks:',
        ...t.acceptance.map((a) => `- ${a}`),
        ...(t.blocked_by.length ? ['', `Blocked by: ${t.blocked_by.join(', ')}`] : []),
      ].join('\n');
      const out = await runShell(command, {
        cwd: repo,
        env: { ...process.env, FACTORY_SUMMARY: t.title, FACTORY_DESCRIPTION: description },
        timeoutMs: 60_000,
      });
      if (out.code !== 0)
        throw new Conflict(
          `Creating ${t.id} in the task manager failed: ${(out.stderr || out.stdout).trim().slice(-500)}`,
        );
      const key = /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(out.stdout)?.[1] ?? /\/issues\/(\d+)/.exec(out.stdout)?.[1];
      const url = /(https?:\/\/\S+)/.exec(out.stdout)?.[1];
      tickets.push({ ...t, ...(key ? { external: { key, ...(url ? { url } : {}) } } : {}) });
      await this.write({ ...feature, tickets: [...tickets, ...feature.tickets.slice(tickets.length)] });
    }
    return { ...feature, tickets };
  }

  // ---------- the implement loop ----------

  startTicking(everyMs = TICK_MS): void {
    this.ticker ??= setInterval(() => void this.tick().catch(() => undefined), everyMs);
    this.ticker.unref();
  }
  stopTicking(): void {
    clearInterval(this.ticker);
    this.ticker = undefined;
  }

  /** One pass of the loop over every implementing feature. Passes never overlap. */
  tick(): Promise<void> {
    this.ticking ??= this.tickOnce().finally(() => (this.ticking = undefined));
    return this.ticking;
  }
  private async tickOnce(): Promise<void> {
    for (const project of await this.deps.projects.list()) {
      const ids = await readdir(join(this.deps.root, project.name, 'features')).catch(() => [] as string[]);
      for (const id of ids) {
        const feature = await this.read(project.name, id).catch(() => undefined);
        if (feature?.stage === 'implementing')
          await this.advance(feature).catch((e: unknown) => this.deps.log?.(`feature ${id}: ${String(e)}`));
      }
    }
  }

  private async advance(feature: Feature): Promise<void> {
    const { project } = feature;
    const tasks = new Map<string, TaskRecord>();
    for (const t of feature.tickets)
      if (t.task_id) {
        const task = await this.deps.tasks.read(project, t.task_id).catch(() => undefined);
        if (task) tasks.set(t.task_id, task);
      }
    // Ticket states follow their tasks.
    let tickets = feature.tickets.map((t): Ticket => {
      const task = t.task_id ? tasks.get(t.task_id) : undefined;
      if (!task)
        return t.blocked_by.length > 1 && !t.blockers_merged_at ? { ...t, state: 'waiting-merge' } : t;
      if (TICKET_DONE_STAGES.includes(task.stage)) return { ...t, state: 'done', error: undefined };
      if (TICKET_FAILED_STAGES.includes(task.stage))
        return { ...t, state: 'failed', error: task.events?.at(-1)?.message ?? task.stage };
      return { ...t, state: 'running' };
    });
    // Start every ticket whose blockers are done.
    const { repo } = await this.deps.projects.read(project);
    const spec = (await this.text(project, feature.id, 'spec.md')) ?? '';
    for (const start of startableTickets({ tickets }, (taskId) => tasks.get(taskId)?.worktree?.branch)) {
      const created = await this.deps.tasks.create(
        project,
        repo,
        ticketPrompt(feature, start.ticket, spec),
        now(),
      );
      await this.deps.tasks.write({
        ...created,
        ticket: { feature: feature.id, id: start.ticket.id },
        ...(start.stackOn ? { stack_on: start.stackOn } : {}),
      });
      tickets = tickets.map((t) =>
        t.id === start.ticket.id ? { ...t, task_id: created.id, state: 'running' } : t,
      );
      await this.write({ ...feature, tickets });
      try {
        await this.deps.startRun(project, created.id);
      } catch (error) {
        tickets = tickets.map((t) =>
          t.id === start.ticket.id ? { ...t, state: 'failed', error: String(error) } : t,
        );
      }
    }
    // A ticket whose PR opened gets a senior-pr-review once.
    for (const t of tickets) {
      const task = t.task_id ? tasks.get(t.task_id) : undefined;
      const number = task?.pr && Number(/\/pull\/(\d+)/.exec(task.pr.url)?.[1]);
      if (!number || !this.deps.reviewPr || t.senior_review_at) continue;
      await this.deps.reviewPr(project, number).catch(() => undefined);
      tickets = tickets.map((x) => (x.id === t.id ? { ...x, senior_review_at: now() } : x));
    }
    const latest = await this.read(project, feature.id);
    const allDone = tickets.every((t) => t.state === 'done');
    await this.write({ ...latest, tickets });
    // When every ticket is done, the QA plan is next.
    if (allDone && !this.busy.has(`${project}/${feature.id}`))
      await this.background({ ...latest, tickets }, 'write-qa', () =>
        this.writeQa(project, feature.id),
      ).catch(() => undefined);
  }
}
