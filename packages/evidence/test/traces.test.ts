import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ModelRunner } from '@factory/core';
import { TraceLog } from '../src/traces.ts';

test('a failed call writes a failed span with its reported cost, and the error still reaches the caller', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-traces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const traces = new TraceLog(root);
  const failing: ModelRunner = {
    run: async () => {
      throw Object.assign(new Error('budget spent'), { costUsd: 0.3 });
    },
  };
  await assert.rejects(
    traces
      .runner(failing, { trace_id: 't', project: 'app' })
      .run({ step: 'coder', model: 'codex', effort: 'low', systemPrompt: '', prompt: '', tools: 'edit' }),
    /budget spent/,
  );
  const [span] = await traces.read('app');
  assert.equal(span!.outcome, 'failed');
  assert.equal(span!.cost_usd, 0.3);
  assert.equal(span!.provider, 'codex');
});

test('ledger health counts unknown costs, missing parents and write errors', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-health-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const traces = new TraceLog(root, undefined, () => {});
  const common = {
    type: 'model' as const,
    name: 'call',
    started_at: '2026-01-01',
    ended_at: '2026-01-01',
    outcome: 'completed' as const,
  };
  traces.append(
    { project: 'demo', trace_id: 'trace' },
    { ...common, span_id: 'root', cost_usd: null },
    { ...common, parent_span_id: 'missing', cost_usd: 1 },
  );
  traces.append({ project: 'demo', trace_id: 'trace' }, { ...common, name: '', cost_usd: null });
  assert.deepEqual(await traces.health(['demo']), {
    unknown_cost_spans: 1,
    missing_parent_links: 1,
    write_errors: 1,
  });
});

test('a trace write error reported from outside the log counts in ledger health', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-traces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const messages: string[] = [];
  const traces = new TraceLog(root, undefined, (error) => messages.push(String(error)));
  traces.reportWriteError(new Error('connect ECONNREFUSED 127.0.0.1:18333'));
  assert.equal((await traces.health([])).write_errors, 1);
  assert.match(messages[0]!, /ECONNREFUSED/);
});

test('a model span records final_chars and no output text', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-traces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const traces = new TraceLog(root);
  const answer = 'the private final answer';
  await traces
    .runner({ run: async () => ({ text: answer, costUsd: 0.1 }) }, { trace_id: 't', project: 'app' })
    .run({ step: 'coder', model: 'codex', effort: 'low', systemPrompt: '', prompt: '', tools: 'edit' });
  const [span] = await traces.read('app');
  assert.equal(span!.attributes?.final_chars, answer.length);
  assert.ok(!JSON.stringify(span).includes('private'), 'the text is never stored');
});
