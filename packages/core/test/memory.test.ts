import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyProposal,
  contextLimit,
  contextStatus,
  digestSession,
  factsPrompt,
  LoopGuard,
  prunedTools,
  recordToolUse,
  type Fact,
  type ToolUsage,
} from '../src/index.ts';

const ids = () => {
  let n = 0;
  return () => `f${++n}`;
};

test('a fact reaches the prompt only after three sessions confirm it, and a contradiction drops it', () => {
  const newId = ids();
  let facts: Fact[] = [];
  const shown = new Set(['s1', 's2', 's3', 's4']);
  facts = applyProposal(
    facts,
    {
      facts: [
        { text: 'Run `pnpm build` before `pnpm test`.', kind: 'build', sessions: ['s1', 's2', 'invented'] },
        { text: 'Use `python -m pytest`; `pytest` is missing.', kind: 'command', sessions: ['nope'] },
      ],
      contradictions: [],
    },
    shown,
    't1',
    newId,
  );
  assert.equal(facts.length, 1, 'a fact backed only by sessions the review was not shown is ignored');
  assert.deepEqual(facts[0]!.sessions, ['s1', 's2'], 'invented session ids do not count');
  assert.equal(facts[0]!.status, 'candidate');
  assert.equal(factsPrompt(facts), undefined);

  facts = applyProposal(
    facts,
    {
      facts: [
        { existing_id: 'f1', text: 'Run `pnpm build` before `pnpm test`.', kind: 'build', sessions: ['s3'] },
      ],
      contradictions: [],
    },
    shown,
    't2',
    newId,
  );
  assert.equal(facts[0]!.status, 'active');
  assert.match(factsPrompt(facts)!, /\[f1\] Run `pnpm build` before `pnpm test`/);

  facts = applyProposal(
    facts,
    { facts: [], contradictions: [{ id: 'f1', session: 's4', reason: 'build is part of test now' }] },
    shown,
    't3',
    newId,
  );
  assert.equal(facts[0]!.status, 'dropped');
  assert.match(facts[0]!.dropped_reason!, /build is part of test now/);
  assert.equal(factsPrompt(facts), undefined);
});

test('a session digest keeps commands, failures with their command, tools and the outcome', () => {
  const digest = digestSession({ id: 's', at: 't', kind: 'coder', provider: 'claude' }, [
    { type: 'tool', name: 'Bash', input: { command: 'pytest -q' } },
    { type: 'tool-result', ok: false, text: 'zsh: command not found: pytest' },
    { type: 'tool', name: 'Bash', input: { command: 'python -m pytest -q' } },
    { type: 'tool-result', ok: true, text: '3 passed' },
    { type: 'tool', name: 'Read', input: { file_path: 'a.py' } },
    { type: 'result', ok: true, text: 'Done.' },
  ]);
  assert.deepEqual(digest.commands, ['pytest -q', 'python -m pytest -q']);
  assert.deepEqual(digest.failures, [
    { tool: 'Bash', input: 'pytest -q', error: 'zsh: command not found: pytest' },
  ]);
  assert.deepEqual(digest.tools, ['Bash', 'Read']);
  assert.equal(digest.ok, true);
});

test('a tool unused for five review sessions is pruned; core tools stay; restoring waits five more', () => {
  let usage: ToolUsage = { sessions: 0, known: [], last_used: {}, restored_at: 0 };
  const offered = ['Bash', 'Read', 'CronCreate', 'DesignSync', 'WebFetch'];
  for (let i = 0; i < 4; i++) usage = recordToolUse(usage, offered, ['Bash', 'WebFetch']);
  assert.deepEqual(prunedTools(usage), []);
  usage = recordToolUse(usage, offered, ['Read']);
  assert.deepEqual(prunedTools(usage), ['CronCreate', 'DesignSync']);
  usage = { ...usage, restored_at: usage.sessions };
  assert.deepEqual(prunedTools(usage), []);
});

test('context limits: model, then provider, then default; warn at 80%', () => {
  const limits = { default: 100_000, codex: 120_000, 'claude-opus-5-5': 180_000 };
  assert.equal(contextLimit(limits, 'claude-opus-5-5'), 180_000);
  assert.equal(contextLimit(limits, 'codex:gpt-5.5'), 120_000);
  assert.equal(contextLimit(limits, 'claude-haiku-5-5'), 100_000);
  assert.equal(contextLimit(undefined, 'claude-haiku-5-5'), 150_000);
  assert.equal(contextLimit(90_000, 'codex'), 90_000);
  assert.deepEqual(contextStatus(79_999, 100_000), {
    tokens: 79_999,
    limit: 100_000,
    warn: false,
    over: false,
  });
  assert.equal(contextStatus(80_000, 100_000).warn, true);
  assert.equal(contextStatus(100_000, 100_000).over, true);
});

test('the loop guard asks the judge after repeated failures, redirects once, then only warns', async () => {
  const asked: string[] = [];
  const warnings: string[] = [];
  const guard = new LoopGuard({
    judge: async (evidence) => (
      asked.push(evidence),
      { stuck: true, confidence: 0.9, redirect: 'Read the error; install the missing tool.', costUsd: 0.01 }
    ),
    onStuck: (n) => warnings.push(n),
  });
  const fail = (n: number) => guard.failure('Bash', `npm run build --attempt ${n}`, 'Error: tsc not found');
  assert.equal(await fail(1), undefined);
  assert.equal(await fail(2), undefined);
  assert.match((await fail(3))!, /repeated 3 times\. Read the error/);
  assert.equal(asked.length, 1);
  for (const n of [4, 5]) assert.equal(await fail(n), undefined);
  assert.equal(await fail(6), undefined, 'no second redirect');
  assert.equal(warnings.length, 1);
  assert.equal(guard.spentUsd, 0.01);

  const unsure = new LoopGuard({
    judge: async () => ({ stuck: true, confidence: 0.5, redirect: 'x', costUsd: null }),
  });
  for (let i = 0; i < 2; i++) await unsure.failure('Bash', 'x', 'e');
  assert.equal(await unsure.failure('Bash', 'x', 'e'), undefined, 'below the confidence bar');
  const broken = new LoopGuard({
    judge: async () => {
      throw new Error('judge down');
    },
  });
  for (let i = 0; i < 2; i++) await broken.failure('Bash', 'x', 'e');
  assert.equal(await broken.failure('Bash', 'x', 'e'), undefined, 'a judge failure never disturbs the turn');
});
