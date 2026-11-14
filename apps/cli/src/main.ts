// `factory` command line: composes the filesystem, git, GitHub and Claude adapters with the driver.
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ClassifierVerdict, describeIssues, readinessDecision, type TaskRecord } from '@factory/core';
import * as fsAdapter from '@factory/adapters-fs';
import * as git from '@factory/adapters-git';
import * as github from '@factory/adapters-github';
import { runShell } from '@factory/adapters-process';
import { ClaudeAgentRunner } from '@factory/adapters-claude';
import { Driver, DriverError, type DriverDeps, type StepPaths } from '@factory/driver';
import { serveHealth } from './serve.ts';
import { doctor } from './doctor.ts';
import { draftProfile } from './profile-draft.ts';

const DEFINITIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'definitions');
const step = (name: string): StepPaths => ({
  step: join(DEFINITIONS, 'steps', `${name}.yaml`),
  ladder: join(DEFINITIONS, 'ladders', `${name}.yaml`),
});

export const HELP = `Usage: factory [options] <command>

Turn a task for a registered repository into a reviewed pull request. Nothing is pushed
and no pull request is opened until a human approves the reviewed commit.

Setup
  project add --name <name> --repo <abs-path>     Register a repository
  project list                                    List registered projects (JSON)
  profile init --project <name>                   Draft <data-root>/<name>/profile.yaml for you to approve
  profile check --project <name>                  Validate the approved profile
  doctor                                          Check Node, git, gh and Claude sign-in

Workflow
  intake --project <name> [--repo <abs-path>] <prompt>   Submit a task; prints its id
  task run --project <p> --id <id> [--max-attempts N]    Classify, code, verify and review; stops at approval
  task gate --project <p> --id <id> [--json]             Show what awaits your approval
  task diff --project <p> --id <id>                      Print the full diff against the base branch
  task approve --project <p> --id <id> --head <sha> [--note <text>] [--accept-blocking]
  task revise --project <p> --id <id> --note <text>      Ask for changes; reruns coder, verify, review
  task reject --project <p> --id <id> --note <text>      Decline the change
  task open-pr --project <p> --id <id> [--draft]         Push the branch and open the PR (approved tasks only)

Individual steps
  task show | list | readiness | classify | prepare-worktree | verify | review | record-verdict | prepare-classifier
  classifier run --request <path>
  verdict check <path>
  definition check-step | check-ladder | check-loop <path>
  serve [--port 4318]                             Local engine health API on 127.0.0.1

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
  const tasks = new fsAdapter.TaskStore(root);
  const log = (line: string) => {
    if (!quiet) process.stderr.write(`${line}\n`);
  };
  const deps: DriverDeps = {
    tasks,
    readProfile: (project) => fsAdapter.readProfile(root, project),
    git,
    shell: { runShell: (command, options) => runShell(command, options) },
    github,
    runner: new ClaudeAgentRunner({ onProgress: log }),
    definitions: {
      readStep: fsAdapter.readStepDefinition,
      readLadder: fsAdapter.readLadder,
      exists: (path) =>
        access(path).then(
          () => true,
          () => false,
        ),
    },
    steps: { classifier: step('classifier'), coder: step('coder'), reviewer: step('reviewer') },
    now: () => new Date().toISOString(),
    log,
  };
  return new Driver(deps);
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
  const tasks = new fsAdapter.TaskStore(root);
  const projects = new fsAdapter.ProjectStore(root);
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
          const name = project();
          const repo = v.repo ?? (await projects.read(name)).repo;
          const path = await fsAdapter.writeProfileDraft(root, name, await draftProfile(name, repo));
          out(path);
          process.stderr.write('Review the draft, set approved_at, then run `factory profile check`.\n');
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
        const port = v.port === undefined ? 4318 : Number(v.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new UsageError(`invalid port: ${v.port}`);
        await serveHealth(root, port);
        return 0;
      }
      case 'doctor':
        return (await doctor(root)) ? 0 : 1;
      case 'task':
        return await taskCommand(sub, { driver, tasks, project, id, v, root });
    }
    throw new UsageError(`unknown command: ${[command, sub].filter(Boolean).join(' ')}`);
  } catch (error) {
    const message = (error as Error).message;
    process.stderr.write(`error: ${message}\n`);
    if (error instanceof UsageError) process.stderr.write('Run `factory --help` for usage.\n');
    return error instanceof UsageError ? 2 : 1;
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
