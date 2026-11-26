import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProjectStore, TaskStore } from '@factory/adapters-fs';
import { ProjectSettings, type ModelRun, type TaskRecord } from '@factory/core';
import { AgentPool, Executions } from '@factory/dispatcher';
import { FeatureService } from '../src/features.ts';

test('a feature goes grill → spec → board → implement (stacked, mirrored) → QA', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-features-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'data');
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  await mkdir(join(repo, '.agents', 'skills', 'grill-with-docs'), { recursive: true });
  await writeFile(
    join(repo, '.agents', 'skills', 'grill-with-docs', 'SKILL.md'),
    '---\nname: x\n---\nRead DOCS_INDEX.md first.',
  );
  const projects = new ProjectStore(root);
  await projects.add('app', repo);
  const tasks = new TaskStore(root);
  const calls: ModelRun[] = [];
  const started: string[] = [];
  const reviewed: number[] = [];
  let grillReplies = 0;
  let rejectBoard = true;
  const runner = {
    run: async (r: ModelRun) => {
      calls.push(r);
      switch (r.step) {
        case 'feature:grill':
          grillReplies++;
          return grillReplies === 1
            ? {
                text: '',
                structured: { message: 'Q1: who uses it? I recommend: voters.', decisions: [], done: false },
                costUsd: 0.1,
                sessionId: 'g1',
              }
            : {
                text: '',
                structured: { message: 'All settled.', decisions: ['Voters use it.'], done: true },
                costUsd: 0.1,
                sessionId: 'g1',
              };
        case 'feature:spec':
          return { text: '# Spec\n\n## Problem\nx', costUsd: 0.5 };
        case 'feature:critique':
          return { text: '- Gap: no error state.', costUsd: 0.2 };
        case 'feature:board-critique':
          return {
            text: '',
            structured: {
              issues: rejectBoard ? [{ ticket: 'T1', reason: 'Requires T2 before deploy' }] : [],
            },
            costUsd: 0,
          };
        case 'feature:tickets':
          return {
            text: '',
            structured: {
              tickets: [
                {
                  id: 'T1',
                  title: 'Add the model',
                  description: 'd1',
                  acceptance: ['a1'],
                  blocked_by: [],
                  size: 'S',
                },
                {
                  id: 'T2',
                  title: 'Add the screen',
                  description: 'd2',
                  acceptance: ['a2'],
                  blocked_by: ['T1'],
                  size: 'M',
                },
                {
                  id: 'T3',
                  title: 'Add the docs $(touch pwned)',
                  description: 'd3',
                  acceptance: ['a3'],
                  blocked_by: [],
                  size: 'S',
                },
              ],
            },
            costUsd: 0.3,
          };
        case 'feature:qa':
          return { text: '# QA plan\n\n- [ ] Open the screen.', costUsd: 0.2 };
        default:
          throw new Error(`unexpected step ${r.step}`);
      }
    },
  };
  const settings = ProjectSettings.parse({
    task_manager: { kind: 'jira', create_ticket: `printf 'Created VOTE-123 %s\\n' {summary}` },
  });
  const pool = new AgentPool({ max: 3 });
  const features = new FeatureService({
    root,
    projects,
    runner: () => runner,
    executions: new Executions({ pool }),
    settings: async () => settings,
    facts: async () => '## What earlier sessions learned about this repository\n\n- [f1] Use pnpm.',
    tasks,
    startRun: async (_p, id) => void started.push(id),
    reviewPr: async (_p, n) => void reviewed.push(n),
  });

  let feature = await features.create({ project: 'app', idea: 'Let voters save a ballot.\nMore detail.' });
  assert.equal(feature.stage, 'grilling');
  assert.equal(feature.title, 'Let voters save a ballot.');
  await features.act({ project: 'app', id: feature.id, action: 'grill' });
  await assert.rejects(
    features.act({ project: 'app', id: feature.id, action: 'grill', text: 'again' }),
    /agent step is running/,
  );
  await features.idle();
  assert.equal(calls[0]!.model, 'claude-sonnet-5-5');
  assert.match(calls[0]!.systemPrompt, /ask exactly one question/i);
  assert.match(
    calls[0]!.systemPrompt,
    /grill-with-docs\/SKILL\.md[\s\S]*Read DOCS_INDEX\.md first\./,
    'the repo skill refines the step',
  );
  assert.match(calls[0]!.systemPrompt, /\[f1\] Use pnpm/, 'confirmed facts reach the step');
  assert.equal(calls[0]!.persistSession, true);
  await features.act({ project: 'app', id: feature.id, action: 'grill', text: 'Voters, yes.' });
  await features.idle();
  assert.equal(calls[1]!.resume, 'g1', 'the grill continues its session');
  feature = await features.read('app', feature.id);
  assert.equal(feature.stage, 'spec');
  assert.deepEqual(feature.decisions, ['Voters use it.']);
  assert.deepEqual(
    feature.grill.turns.map((x) => x.role),
    ['agent', 'user', 'agent'],
  );

  await features.act({ project: 'app', id: feature.id, action: 'write-spec' });
  await features.idle();
  const withSpec = await features.detail({ project: 'app', id: feature.id });
  assert.match(withSpec.spec!, /## Problem/);
  assert.equal(calls.find((c) => c.step === 'feature:spec')!.model, 'claude-opus-5-5');
  assert.match(withSpec.critique!, /no error state/);
  assert.equal(
    calls.find((c) => c.step === 'feature:critique')!.model,
    'claude-sonnet-5-5',
    'a second model critiques',
  );
  await assert.rejects(
    features.act({ project: 'app', id: feature.id, action: 'plan' }),
    /needs the feature in spec-approved/,
  );
  await features.act({ project: 'app', id: feature.id, action: 'approve-spec' });
  await features.act({ project: 'app', id: feature.id, action: 'plan' });
  await features.idle();
  feature = await features.read('app', feature.id);
  assert.equal(feature.stage, 'spec-approved');
  assert.match(feature.error!, /T1: Requires T2 before deploy/);
  rejectBoard = false;
  await features.act({ project: 'app', id: feature.id, action: 'plan' });
  await features.idle();
  feature = await features.read('app', feature.id);
  assert.equal(feature.stage, 'board');
  await assert.rejects(
    features.act({
      project: 'app',
      id: feature.id,
      action: 'save-board',
      tickets: [{ ...feature.tickets[0]!, blocked_by: ['T1'] }],
    }),
    /T1 blocks itself/,
  );

  await features.act({ project: 'app', id: feature.id, action: 'approve-board', mirror: true });
  await features.tick();
  feature = await features.read('app', feature.id);
  assert.equal(feature.stage, 'implementing');
  assert.deepEqual(
    feature.tickets.map((x) => x.external?.key?.startsWith('VOTE-')),
    [true, true, true],
  );
  assert.equal(
    execFileSync('ls', [repo]).toString().includes('pwned'),
    false,
    'ticket text is never run by the shell',
  );
  assert.deepEqual(
    feature.tickets.map((x) => x.state),
    ['running', 'waiting', 'running'],
  );
  assert.equal(started.length, 2, 'T1 and T3 start in parallel; T2 waits for T1');
  const t1 = await tasks.read('app', feature.tickets[0]!.task_id!);
  assert.deepEqual(t1.ticket, { feature: feature.id, id: 'T1' });
  assert.match(t1.prompt, /^Add the model[\s\S]*Acceptance checks:\n- a1[\s\S]*<spec>/);

  // T1 reaches the approval gate with its worktree: T2 starts, stacked on T1's branch.
  const gate = (task: TaskRecord, extra: Partial<TaskRecord> = {}) =>
    tasks.write({
      ...task,
      stage: 'awaiting-approval',
      worktree: { path: '/w', branch: `factory/${task.id}`, base_branch: 'main' },
      ...extra,
    });
  await gate(t1);
  await features.tick();
  feature = await features.read('app', feature.id);
  const t2 = await tasks.read('app', feature.tickets[1]!.task_id!);
  assert.equal(t2.stack_on, `factory/${t1.id}`);
  assert.equal(started.length, 3);

  // An opened PR gets a senior-pr-review once; when every ticket is done the QA plan is written.
  await gate(await tasks.read('app', t1.id), {
    stage: 'pr-opened',
    pr: { url: 'https://github.com/o/r/pull/41', branch: 'b', head_sha: 'h', at: 'now' },
  });
  await gate(t2);
  await gate(await tasks.read('app', feature.tickets[2]!.task_id!));
  await features.tick();
  await features.tick();
  await features.idle();
  assert.deepEqual(reviewed, [41]);
  const done = await features.detail({ project: 'app', id: feature.id });
  assert.equal(done.stage, 'qa');
  assert.match(done.qa!, /Open the screen/);
  assert.equal(calls.find((c) => c.step === 'feature:tickets')!.model, 'claude-sonnet-5-5');
  assert.equal(calls.find((c) => c.step === 'feature:qa')!.model, 'claude-sonnet-5-5');
  assert.match(calls.at(-1)!.prompt, /T1 Add the model: done, PR https:\/\/github\.com\/o\/r\/pull\/41/);
  assert.match(calls.at(-1)!.prompt, /Ticket T1: diff unavailable/);
  assert.equal(calls.at(-1)!.tools, 'none');
  assert.equal(Number(done.cost_usd.toFixed(2)), 1.7);
  assert.equal(done.total_cost_usd, done.cost_usd + done.tickets_cost_usd);
  assert.equal(pool.inUse(), 0, 'every step returned its agent slot');
  await features.act({ project: 'app', id: feature.id, action: 'complete' });
  assert.equal((await features.read('app', feature.id)).stage, 'done');
  assert.equal((await features.list('app'))[0]!.tickets, 3);
  assert.ok(await readFile(join(root, 'app', 'features', feature.id, 'spec.md'), 'utf8'));
});

test('feature commands follow the shared policy: ended features stay ended, a failed QA step waits', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-feature-controls-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'data');
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  const projects = new ProjectStore(root);
  await projects.add('app', repo);
  const tasks = new TaskStore(root);
  let releaseSpec: (() => void) | undefined;
  let qaCalls = 0;
  let refuseClose = false;
  const closed: string[] = [];
  const one = {
    id: 'T1',
    title: 'Add the model',
    description: 'd',
    acceptance: ['a'],
    blocked_by: [],
    size: 'S',
  };
  const runner = {
    run: async (r: ModelRun) => {
      if (r.step === 'feature:spec') {
        await new Promise<void>((resolve) => (releaseSpec = resolve));
        return { text: '# Spec', costUsd: 0.5 };
      }
      if (r.step === 'feature:critique') return { text: 'ok', costUsd: 0 };
      if (r.step === 'feature:tickets') return { text: '', structured: { tickets: [one] }, costUsd: 0 };
      if (r.step === 'feature:board-critique') return { text: '', structured: { issues: [] }, costUsd: 0 };
      qaCalls++;
      throw new Error('the QA model is down');
    },
  };
  const features = new FeatureService({
    root,
    projects,
    runner: () => runner,
    executions: new Executions({ pool: new AgentPool({ max: 3 }) }),
    settings: async () => ProjectSettings.parse({}),
    facts: async () => undefined,
    tasks,
    startRun: async () => undefined,
    closeRun: async (_project, id) => {
      if (refuseClose) throw new Error('the run is busy');
      closed.push(id);
    },
  });
  const allowed = async (id: string) =>
    (await features.detail({ project: 'app', id })).actions.filter((a) => a.allowed).map((a) => a.action);
  const spec = async (id: string) => {
    await features.act({ project: 'app', id, action: 'write-spec' });
    while (!releaseSpec) await new Promise((resolve) => setTimeout(resolve, 5));
  };

  // Cancel passes a running step; the step's late result keeps its cost and does not reopen the feature.
  const cancelled = await features.create({ project: 'app', idea: 'Cancel me' });
  assert.deepEqual(await allowed(cancelled.id), ['grill', 'skip-grill', 'write-spec', 'cancel']);
  await spec(cancelled.id);
  assert.deepEqual(await allowed(cancelled.id), ['cancel']);
  await features.act({ project: 'app', id: cancelled.id, action: 'cancel' });
  releaseSpec!();
  releaseSpec = undefined;
  await features.idle();
  const after = await features.read('app', cancelled.id);
  assert.deepEqual([after.stage, after.cost_usd], ['cancelled', 0.5]);
  assert.deepEqual(await allowed(cancelled.id), []);
  // A second cancel is not an error; any other command is refused.
  assert.equal(
    (await features.act({ project: 'app', id: cancelled.id, action: 'cancel' })).stage,
    'cancelled',
  );
  await assert.rejects(
    features.act({ project: 'app', id: cancelled.id, action: 'skip-grill' }),
    /is cancelled; it accepts no more commands/,
  );

  // The QA step fails once; later passes wait for a person to retry it.
  const feature = await features.create({ project: 'app', idea: 'Ship it' });
  const act = (action: string, extra: object = {}) =>
    features.act({ project: 'app', id: feature.id, action, ...extra } as never);
  await spec(feature.id);
  releaseSpec!();
  await features.idle();
  await act('approve-spec');
  await act('plan');
  await features.idle();
  await act('approve-board');
  await features.tick();
  await assert.rejects(act('mark-merged', { ticket: 'T9' }), /has no ticket T9/);
  const [ticket] = (await features.read('app', feature.id)).tickets;
  await tasks.write({ ...(await tasks.read('app', ticket!.task_id!)), stage: 'awaiting-approval' });
  for (let pass = 0; pass < 3; pass++) {
    await features.tick();
    await features.idle();
  }
  assert.equal(qaCalls, 1, 'a failed QA step is not started again by the loop');
  const failed = await features.detail({ project: 'app', id: feature.id });
  assert.deepEqual([failed.stage, failed.error], ['implementing', 'the QA model is down']);
  assert.ok((await allowed(feature.id)).includes('write-qa'), 'a person can retry it');
  await act('write-qa');
  await features.idle();
  assert.equal(qaCalls, 2);

  // Cancel closes the open runs of the tickets; a run that cannot be closed is named.
  assert.equal((await act('cancel')).error, undefined);
  assert.deepEqual(closed, [ticket!.task_id]);
  const other = await features.create({ project: 'app', idea: 'Cancel with a busy run' });
  const run = await tasks.create('app', repo, 'x', 'now');
  await writeFile(
    join(root, 'app', 'features', other.id, 'feature.json'),
    JSON.stringify({
      ...other,
      stage: 'implementing',
      tickets: [{ ...one, task_id: run.id, state: 'running' }],
    }),
  );
  refuseClose = true;
  const left = await features.act({ project: 'app', id: other.id, action: 'cancel' });
  assert.equal(left.stage, 'cancelled');
  assert.match(left.error!, /T1: the run is busy/);
  // An open pull request is not closed.
  await tasks.write({ ...(await tasks.read('app', ticket!.task_id!)), stage: 'pr-opened' });
  assert.equal(closed.length, 1);
});

test('a feature step runs as an execution: cancel stops its model call, and shutdown interrupts it', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-feature-lifecycle-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'data');
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  const projects = new ProjectStore(root);
  await projects.add('app', repo);
  let started = 0;
  let aborted = 0;
  const runner = {
    // The spec step waits until its signal aborts, like a model call that a stop cuts off.
    run: (r: ModelRun) =>
      new Promise<never>((_, reject) => {
        started++;
        r.signal?.addEventListener('abort', () => {
          aborted++;
          reject(Object.assign(new Error('model run stopped: aborted'), { kind: 'aborted' }));
        });
      }),
  };
  const pool = new AgentPool({ max: 3 });
  const executions = new Executions({ pool, log: () => {} });
  const features = new FeatureService({
    root,
    projects,
    runner: () => runner,
    executions,
    settings: async () => ProjectSettings.parse({}),
    facts: async () => undefined,
    tasks: new TaskStore(root),
    startRun: async () => undefined,
  });
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((done) => setTimeout(done, 5));
  };

  const cancelled = await features.create({ project: 'app', idea: 'Cancel me' });
  await features.act({ project: 'app', id: cancelled.id, action: 'write-spec' });
  await waitFor(() => started === 1);
  assert.equal(pool.inUse(), 1);
  await features.act({ project: 'app', id: cancelled.id, action: 'cancel' });
  await features.idle();
  assert.equal(aborted, 1, 'the cancel reached the model call');
  assert.equal(pool.inUse(), 0, 'the slot came back');
  const after = await features.read('app', cancelled.id);
  assert.deepEqual([after.stage, after.working, after.error], ['cancelled', undefined, undefined]);

  const stopped = await features.create({ project: 'app', idea: 'Stop me at shutdown' });
  await features.act({ project: 'app', id: stopped.id, action: 'write-spec' });
  await waitFor(() => started === 2);
  await executions.drain(10);
  const interrupted = await features.read('app', stopped.id);
  assert.equal(interrupted.working, undefined);
  assert.match(interrupted.error!, /backend stopped during this step/);
  assert.equal(pool.inUse(), 0);
});
