import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { claudeCli } from '@factory/adapters-claude';
import type { ModelRun } from '@factory/core';
import { MemoryService } from '../src/memory.ts';

test('memory records tool-using sessions, reviews every third, confirms facts and never keeps secrets', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-memory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reviews: ModelRun[] = [];
  const memory = new MemoryService(root, () => ({
    run: async (request) => {
      reviews.push(request);
      const sessions = [...request.prompt.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]!);
      return {
        text: '',
        structured: {
          facts: [
            { text: 'Use `python -m pytest`; `pytest` is not installed.', kind: 'command', sessions },
            { text: 'Deploy with token=abc123456789', kind: 'other', sessions },
          ],
          contradictions: [],
        },
        costUsd: 0.004,
      };
    },
  }));
  const base = {
    run: async (r: ModelRun) => (
      r.onEvent?.({ type: 'tool', name: 'Bash', input: { command: 'pytest' } }),
      { text: 'ok', costUsd: 0.1 }
    ),
  };
  const recording = memory.recording('app', 'run1', base);
  await recording.run({
    step: 'classifier',
    model: 'claude-haiku-5-5',
    effort: 'low',
    systemPrompt: '',
    prompt: '',
    tools: 'none',
  });
  for (let i = 0; i < 3; i++)
    await recording.run({
      step: 'coder',
      model: 'claude-sonnet-5-5',
      effort: 'low',
      systemPrompt: '',
      prompt: '',
      tools: 'edit',
    });
  await memory.idle();
  assert.equal(
    reviews.length,
    1,
    'one review after three tool-using sessions; the classifier is not a session',
  );
  assert.equal(reviews[0]!.tools, 'none');
  const snapshot = await memory.snapshot('app');
  assert.equal(snapshot.sessions, 3);
  assert.equal(snapshot.pending, 0);
  assert.equal(snapshot.review_cost_usd, 0.004);
  assert.deepEqual(
    snapshot.facts.map((f) => [f.text, f.status, f.sessions.length]),
    [['Use `python -m pytest`; `pytest` is not installed.', 'active', 3]],
    'the fact that looks like a credential is never stored',
  );
  assert.match((await memory.prompt('app'))!, /python -m pytest/);
  await memory.forget('app', snapshot.facts[0]!.id);
  assert.equal(await memory.prompt('app'), undefined);
  assert.match(
    await readFile(join(root, 'app', 'memory', 'sessions.jsonl'), 'utf8'),
    /"commands":\["pytest"\]/,
  );
});

test('review turns leave out pruned tools, and restoring brings them back', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-memory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const memory = new MemoryService(root, () => ({ run: async () => ({ text: '', costUsd: 0 }) }));
  for (let i = 0; i < 5; i++)
    await memory.recordTools('app', ['Bash', 'Read', 'CronCreate', 'PublishPlugin'], ['Bash']);
  assert.deepEqual(await memory.pruned('app'), ['CronCreate', 'PublishPlugin']);
  const args = claudeCli.args(
    { message: 'm', systemPromptFile: '/p', deny: [], tools: ['Bash', 'Read'] },
    { systemPrompt: '' },
  );
  assert.deepEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), [
    '--tools',
    'Bash,Read',
  ]);
  await memory.restoreTools('app');
  assert.deepEqual(await memory.pruned('app'), []);
});
