import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProjectStore, TaskStore } from '@factory/adapters-fs';
import { ProjectSettings, type ModelRun, type TaskRecord } from '@factory/core';
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
    task_manager: { kind: 'jira', create_ticket: `printf 'Created VOTE-%s %s\\n' "$RANDOM" {summary}` },
  });
  let slots = 3;
  const features = new FeatureService({
    root,
    projects,
    runner: () => runner,
    slot: async () => (slots > 0 ? (slots--, () => void slots++) : undefined),
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
  assert.match(calls.at(-1)!.prompt, /T1 Add the model: done, PR https:\/\/github\.com\/o\/r\/pull\/41/);
  assert.equal(Number(done.cost_usd.toFixed(2)), 1.4);
  assert.equal(slots, 3, 'every step returned its agent slot');
  await features.act({ project: 'app', id: feature.id, action: 'complete' });
  assert.equal((await features.read('app', feature.id)).stage, 'done');
  assert.equal((await features.list('app'))[0]!.tickets, 3);
  assert.ok(await readFile(join(root, 'app', 'features', feature.id, 'spec.md'), 'utf8'));
});
