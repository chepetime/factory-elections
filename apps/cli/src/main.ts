// `factory` command line: composes the filesystem, git, GitHub and Claude adapters with the driver.
import '../../../scripts/load-env.ts';
import { resolve, join } from 'node:path';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ClassifierVerdict,
  TaskControls,
  currentPrDraft,
  describeIssues,
  readinessDecision,
  type TaskRecord,
} from '@factory/core';
import * as fsAdapter from '@factory/adapters-fs';
import { storageFor } from '@factory/adapters-data';
import { Driver, DriverError, type StepPaths } from '@factory/driver';
import { composeDriver as createDriver } from '@factory/backend/compose';
import { serveHealth } from './serve.ts';
import { doctor } from './doctor.ts';

export const HELP = `Usage: factory [options] <command>

Turn a task for a registered repository into a reviewed pull request. Nothing is pushed
and no pull request is opened until a human approves the reviewed commit.

Setup
  project add --name <name> --repo <abs-path>     Register a repository
  project list                                    List registered projects (JSON)
  profile init --project <name>                   Draft <data-root>/<name>/profile.yaml for you to approve
  profile check --project <name>                  Validate the approved profile
  doctor                                          Check Node, git, pnpm, gh and Claude sign-in

Workflow
  intake --project <name> [--repo <abs-path>] <prompt>   Submit a task; prints its id
  task actions --project <p> --id <id>               JSON action availability from the running backend
  task run --project <p> --id <id> [--max-attempts N]    Classify, code, verify and review; stops at approval
  task gate --project <p> --id <id> [--json]             Show what awaits your approval
  task diff --project <p> --id <id>                      Print the full diff against the base branch
  task approve --project <p> --id <id> --head <sha> [--note <text>] [--accept-blocking]
  task revise --project <p> --id <id> --note <text>      Ask for changes; reruns coder, verify, review
  task reject --project <p> --id <id> --note <text>      Decline the change
  task open-pr --project <p> --id <id> [--draft]         Push the branch and open the PR (approved tasks only)

Individual steps
  task show | list | readiness | classify | prepare-worktree | verify | review | draft-pr | record-verdict | prepare-classifier
  classifier run --request <path>
  verdict check <path>
  definition check-step | check-ladder | check-loop <path>
  serve [--port 4318]                             Local backend (gRPC :4319, health :4318)

Options
  -h, --help                                      Show this help

Data root: $FACTORY_ROOT, or ~/.local/share/factory.
`;

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  project: { type: 'string' },
  repo: { type: 'string' },
  id: { type: 'string' },
  name: { type: 'string' },
  verdict: { type: 'string' },
  step: { type: 'string' },
  ladder: { type: 'string' },
  request: { type: 'string' },
  port: { type: 'string' },
  head: { type: 'string' },
  note: { type: 'string' },
  'accept-blocking': { type: 'boolean' },
  draft: { type: 'boolean' },
  'max-attempts': { type: 'string' },
  quiet: { type: 'boolean', short: 'q' },
  json: { type: 'boolean' },
} as const;

class UsageError extends Error {}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new UsageError(`missing required --${flag}`);
  return value;
}

function out(value: unknown): void {
  process.stdout.write(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value)}\n`);
}

export function composeDriver(root: string, quiet = false): Driver {
  return createDriver(root, (line) => {
    if (!quiet) process.stderr.write(`${line}\n`);
  });
}

function maxAttempts(value: string | undefined): number {
  if (value === undefined) return 3;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10)
    throw new UsageError('--max-attempts must be an integer from 1 to 10');
  return n;
}

function gateText(gate: Awaited<ReturnType<Driver['gate']>>): string {
  const { task, headSha, diffStat, blockers } = gate;
  const lines = [`Task ${task.id} — stage: ${task.stage}`, '', task.prompt.trim(), ''];
  lines.push(
    `Branch ${task.worktree?.branch ?? '-'} → ${task.worktree?.base_branch ?? '-'}, head ${headSha.slice(0, 12)}`,
  );
  lines.push(`Worktree: ${task.worktree?.path ?? '-'}`, '', diffStat.trimEnd(), '');
  lines.push(
    `Verification: ${task.verification ? (task.verification.passed ? 'passed' : 'FAILED') + ` at ${task.verification.head_sha.slice(0, 12)}` : 'not run'}`,
  );
  if (task.review) {
    lines.push(
      `Review (${task.review.head_sha.slice(0, 12)}): ${task.review.verdict} — ${task.review.summary}`,
    );
    for (const f of task.review.findings)
      lines.push(`  [${f.severity}] ${f.file ? `${f.file}: ` : ''}${f.message}`);
  } else lines.push('Review: not run');
  const draft = currentPrDraft(task, headSha);
  if (draft) lines.push('', `Pull request draft: ${draft.title}`, '', indent(draft.body), '');
  else lines.push('Pull request draft: none for this commit (the PR will use the task summary)');
  const cost = (task.attempts ?? []).reduce<number | null>(
    (sum, a) => (a.cost_usd === null || sum === null ? null : sum + a.cost_usd),
    0,
  );
  lines.push(
    `Model attempts: ${(task.attempts ?? []).length}, estimated cost: ${cost === null ? 'unknown' : `$${cost.toFixed(2)}`}`,
    '',
  );
  if (task.pr) lines.push(`Pull request: ${task.pr.url}`);
  else if (blockers.length) lines.push(`Not ready for approval: ${blockers.join('; ')}`);
  else if (task.stage === 'approved')
    lines.push(`Approved. Next: factory task open-pr --project ${task.project} --id ${task.id}`);
  else
    lines.push(
      'Next, after reading `factory task diff`:',
      `  approve:  factory task approve --project ${task.project} --id ${task.id} --head ${headSha.slice(0, 12)}`,
      `  revise:   factory task revise --project ${task.project} --id ${task.id} --note "<what to change>"`,
      `  reject:   factory task reject --project ${task.project} --id ${task.id} --note "<why>"`,
    );
  return lines.join('\n');
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    process.stderr.write(`error: ${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values: v, positionals } = parsed;
  const [command, sub, ...rest] = positionals;
  if (v.help || !command) {
    process.stdout.write(HELP);
    return v.help ? 0 : 2;
  }
  const root = fsAdapter.dataRoot();
  const driver = composeDriver(root, v.quiet);
  const { tasks, projects } = storageFor(root);
  const project = () => fsAdapter.checkProjectName(required(v.project, 'project'));
  const id = () => fsAdapter.checkTaskId(required(v.id, 'id'));

  try {
    switch (command) {
      case 'intake': {
        const prompt = [sub, ...rest].filter((p) => p !== undefined).join(' ');
        const name = project();
        const repo = v.repo ?? (await projects.read(name).catch(() => undefined))?.repo;
        if (!repo)
          throw new UsageError('missing --repo (or register the project with `factory project add`)');
        const task = await tasks.create(name, repo, prompt, new Date().toISOString());
        out(task.id);
        return 0;
      }
      case 'project':
        if (sub === 'add') {
          const created = await projects.add(required(v.name, 'name'), required(v.repo, 'repo'));
          out(`Project added: ${created.name}`);
          return 0;
        }
        if (sub === 'list') return (out(await projects.list()), 0);
        break;
      case 'profile':
        if (sub === 'check') {
          await fsAdapter.readProfile(root, project());
          out(`Profile valid: ${v.project}`);
          return 0;
        }
        if (sub === 'init') {
          const { draftProfile } = await import('./profile-draft.ts');
          const name = project();
          const repo = v.repo ?? (await projects.read(name)).repo;
          const path = await fsAdapter.writeProfileDraft(root, name, await draftProfile(name, repo));
          out(path);
          process.stderr.write(
            `Review the draft, set approved_at, then run \`factory profile check --project ${name}\`.\n`,
          );
          return 0;
        }
        break;
      case 'definition': {
        const path = required(sub === undefined ? undefined : rest[0], 'path');
        if (sub === 'check-step')
          return (out(`Step valid: ${(await fsAdapter.readStepDefinition(path)).step.name}`), 0);
        if (sub === 'check-ladder')
          return (out(`Ladder valid: ${(await fsAdapter.readLadder(path)).name}`), 0);
        if (sub === 'check-loop') return (out(`Loop valid: ${(await fsAdapter.readLoop(path)).name}`), 0);
        break;
      }
      case 'verdict':
        if (sub === 'check') {
          const parsedVerdict = ClassifierVerdict.safeParse(
            await fsAdapter.readJsonFile(required(rest[0], 'path'), 'verdict'),
          );
          if (!parsedVerdict.success)
            throw new DriverError(`invalid verdict: ${describeIssues(parsedVerdict.error)}`);
          out(`Verdict valid: ${parsedVerdict.data.intake_id}`);
          return 0;
        }
        break;
      case 'classifier':
        if (sub === 'run') {
          const request = await fsAdapter.readJsonFile(required(v.request, 'request'), 'classifier request');
          out(await driver.runClassifierRequest(request));
          return 0;
        }
        break;
      case 'serve': {
        const port = v.port === undefined ? Number(process.env.FACTORY_HEALTH_PORT ?? 4318) : Number(v.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new UsageError(`invalid port: ${v.port}`);
        await serveHealth(root, port);
        return 0;
      }
      case 'doctor':
        return (await doctor(root)) ? 0 : 1;
      case 'task': {
        const execute = () => taskCommand(sub, { driver, tasks, project, id, v, root });
        const exclusive = new Set([
          'record-verdict',
          'classify',
          'prepare-worktree',
          'verify',
          'review',
          'draft-pr',
          'run',
          'approve',
          'reject',
          'revise',
          'open-pr',
        ]);
        if (exclusive.has(sub ?? '')) {
          const serving = await access(join(root, 'backend.lock')).then(
            () => true,
            (error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return false;
              throw error;
            },
          );
          if (serving) return await taskViaBackend(sub!, project(), id(), v, driver);
          return await tasks.withLock(project(), id(), execute);
        }
        return await execute();
      }
    }
    throw new UsageError(`unknown command: ${[command, sub].filter(Boolean).join(' ')}`);
  } catch (error) {
    const message = (error as Error).message;
    process.stderr.write(`error: ${message}\n`);
    if (error instanceof UsageError) process.stderr.write('Run `factory --help` for usage.\n');
    return error instanceof UsageError ? 2 : 1;
  }
}

async function taskViaBackend(
  action: string,
  project: string,
  id: string,
  values: Record<string, string | boolean | undefined>,
  driver: Driver,
): Promise<number> {
  if (!['run', 'revise', 'approve', 'reject', 'open-pr'].includes(action))
    throw new DriverError(
      'This individual step requires the backend to be stopped. Use run or revise while it is serving.',
    );
  const { backendCall } = await import('@factory/backend/client');
  const { closeBackendClient } = await import('@factory/backend/client');
  const text = (key: string) => (typeof values[key] === 'string' ? (values[key] as string) : undefined);
  const request = {
    project,
    id,
    action,
    head: text('head'),
    note: text('note'),
    draft: Boolean(values.draft),
    accept_blocking: Boolean(values['accept-blocking']),
    max_attempts: maxAttempts(text('max-attempts')),
  };
  try {
    if (action === 'approve') required(request.head, 'head');
    if (action === 'revise' || action === 'reject') required(request.note, 'note');
    if (action !== 'run' && action !== 'revise') {
      out((await backendCall('ExecuteTask', request, 300_000)).text);
      return 0;
    }
    const accepted = JSON.parse((await backendCall('StartRun', request)).json) as { id: string };
    let previous = '';
    for (;;) {
      const run = JSON.parse((await backendCall('GetBackground', { project, id })).json) as {
        runId: string;
        running: boolean;
        logTail?: string;
        state: string;
        error?: string;
      };
      if (run.runId !== accepted.id)
        throw new DriverError('The latest run changed; inspect the task evidence');
      if (run.logTail && run.logTail !== previous && !values.quiet) {
        process.stderr.write(
          run.logTail.startsWith(previous) ? run.logTail.slice(previous.length) : `\n${run.logTail}`,
        );
        previous = run.logTail;
      }
      if (!run.running) {
        if (run.state !== 'completed') throw new DriverError(run.error ?? `Run ${run.state}`);
        const task = await driver.deps.tasks.read(project, id);
        out(task.stage);
        if (task.stage === 'blocked') return 3;
        process.stderr.write(`\n${gateText(await driver.gate(project, id))}\n`);
        return 0;
      }
      await new Promise((done) => setTimeout(done, 500));
    }
  } finally {
    closeBackendClient();
  }
}

async function taskCommand(
  sub: string | undefined,
  ctx: {
    driver: Driver;
    tasks: fsAdapter.TaskStore;
    project: () => string;
    id: () => string;
    v: Record<string, string | boolean | undefined>;
    root: string;
  },
): Promise<number> {
  const { driver, tasks, project, id, v } = ctx;
  const str = (key: string) => (typeof v[key] === 'string' ? (v[key] as string) : undefined);
  const paths = (): StepPaths | undefined => {
    const s = str('step');
    const l = str('ladder');
    if (!s && !l) return undefined;
    return { step: required(s, 'step'), ladder: required(l, 'ladder') };
  };
  const show = (task: TaskRecord) => out(task);
  switch (sub) {
    case 'actions': {
      const { backendCall, closeBackendClient } = await import('@factory/backend/client');
      try {
        out(
          TaskControls.parse(
            JSON.parse((await backendCall('GetTaskControls', { project: project(), id: id() })).json),
          ),
        );
        return 0;
      } finally {
        closeBackendClient();
      }
    }
    case 'show':
      return (show(await tasks.read(project(), id())), 0);
    case 'list':
      return (out(await tasks.list(project())), 0);
    case 'record-verdict': {
      const raw = await fsAdapter.readJsonFile(required(str('verdict'), 'verdict'), 'verdict');
      await driver.recordVerdict(project(), id(), raw);
      return (out(`Verdict recorded: ${v.id}`), 0);
    }
    case 'readiness':
      return (out(await driver.readiness(project(), id())), 0);
    case 'prepare-classifier':
      return (out(await driver.prepareClassifierRequest(project(), id(), paths())), 0);
    case 'classify':
      await driver.classify(project(), id(), paths());
      return (out(`Verdict recorded: ${v.id}`), 0);
    case 'prepare-worktree':
      return (out((await driver.prepareWorktree(project(), id())).worktree!.path), 0);
    case 'verify': {
      const result = await driver.verify(project(), id());
      if (!result.passed) throw new DriverError('verification failed');
      return (out(`Verification passed: ${v.id}`), 0);
    }
    case 'review': {
      const task = await driver.review(project(), id());
      return (out(`Review recorded: ${task.review!.verdict}`), 0);
    }
    case 'draft-pr': {
      const task = await driver.draftPr(project(), id());
      return (out(`PR drafted: ${task.pr_draft!.title}`), 0);
    }
    case 'run': {
      const task = await driver.run(project(), id(), { maxAttempts: maxAttempts(str('max-attempts')) });
      if (task.stage === 'blocked') {
        const decision = readinessDecision(task.verdict!);
        process.stderr.write(`Task is not ready (${decision.action}). Blockers:\n`);
        for (const b of task.verdict!.blockers) process.stderr.write(`  [${b.kind}] ${b.question}\n`);
        process.stderr.write('Submit a clearer task with `factory intake`.\n');
        out(task.stage);
        return 3;
      }
      process.stderr.write(`\n${gateText(await driver.gate(task.project, task.id))}\n`);
      return (out(task.stage), 0);
    }
    case 'gate': {
      const gate = await driver.gate(project(), id());
      if (v.json) {
        out({ task: gate.task, head_sha: gate.headSha, diff_stat: gate.diffStat, blockers: gate.blockers });
        return 0;
      }
      return (out(gateText(gate)), 0);
    }
    case 'diff':
      return (process.stdout.write(await driver.diff(project(), id())), 0);
    case 'approve': {
      const task = await driver.approve(project(), id(), {
        head: required(str('head'), 'head'),
        note: str('note'),
        acceptBlocking: Boolean(v['accept-blocking']),
      });
      out(`Approved: ${task.approval!.head_sha}`);
      process.stderr.write(`Next: factory task open-pr --project ${task.project} --id ${task.id}\n`);
      return 0;
    }
    case 'reject':
      await driver.reject(project(), id(), required(str('note'), 'note'));
      return (out(`Rejected: ${v.id}`), 0);
    case 'revise': {
      const task = await driver.revise(project(), id(), required(str('note'), 'note'), {
        maxAttempts: maxAttempts(str('max-attempts')),
      });
      process.stderr.write(`\n${gateText(await driver.gate(task.project, task.id))}\n`);
      return (out(task.stage), 0);
    }
    case 'open-pr': {
      const task = await driver.openPr(project(), id(), { draft: Boolean(v.draft) });
      return (out(task.pr!.url), 0);
    }
  }
  throw new UsageError(`unknown command: task ${sub ?? ''}`.trim());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `    ${line}` : line))
    .join('\n');
}
