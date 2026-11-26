import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ModelRun, ModelRunner } from '@factory/core';
import { DelegationServer } from '@factory/agents';
import { TraceLog } from '@factory/evidence';

test('a traced call writes its model span, tool spans, the loop judge and a child task under it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-traces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const traces = new TraceLog(root);
  const base: ModelRunner = {
    async run(request: ModelRun) {
      if (request.step?.startsWith('delegate:'))
        return { text: 'child done', costUsd: null, usage: { inputTokens: 10, outputTokens: 2 } };
      request.onEvent?.({ type: 'tool', name: 'Bash', input: { command: 'pnpm test' } });
      request.onEvent?.({ type: 'tool-result', ok: false, text: 'exit 1' });
      request.onEvent?.({
        type: 'judge',
        stuck: true,
        confidence: 0.9,
        costUsd: 0.01,
        startedAt: new Date().toISOString(),
        durationMs: 5,
      });
      // The agent starts a child through its grant while the call runs.
      const res = await fetch(request.mcp!.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${request.mcp!.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'delegate', arguments: { provider: 'codex', task: 'look', access: 'read-only' } },
        }),
      });
      assert.equal(res.status, 200);
      return {
        text: 'ok',
        costUsd: 0.51,
        usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80, cacheWriteInputTokens: 10 },
      };
    },
  };
  const server = new DelegationServer({
    runner: traces.runner(base, () => undefined),
    slot: async () => () => {},
    traceParent: (token) => traces.grantParent(token),
  });
  await server.start();
  t.after(() => server.close());
  const grant = server.grant({ label: 'coder', cwd: root, access: 'edit', budgetUsd: 1 })!;
  const scope = { trace_id: 'trace1', project: 'app', task_id: 'task1', parent_span_id: 'run1' };
  await traces.runner(base, scope).run({
    step: 'coder',
    model: 'claude-sonnet-5-5',
    effort: 'low',
    systemPrompt: '',
    prompt: '',
    tools: 'edit',
    mcp: grant.endpoint,
  });

  const spans = await traces.read('app', { trace_id: 'trace1' });
  const model = spans.find((s) => s.type === 'model')!;
  assert.equal(model.parent_span_id, 'run1');
  assert.equal(model.provider, 'claude');
  assert.deepEqual(model.tokens, { input: 100, output: 20, cache_read: 80, cache_write: 10 });
  assert.equal(model.cost_source, 'reported');
  assert.ok(Math.abs(model.cost_usd! - 0.5) < 1e-9, 'the judge cost moves to the judge span');
  const byType = (type: string) => spans.filter((s) => s.type === type);
  assert.equal(byType('tool')[0]!.parent_span_id, model.span_id);
  assert.equal(byType('tool')[0]!.outcome, 'failed');
  assert.equal(byType('loop-judge')[0]!.cost_usd, 0.01);
  const child = byType('child')[0]!;
  assert.equal(child.parent_span_id, model.span_id, 'the child hangs under the call that started it');
  assert.equal(child.task_id, 'task1');
  assert.equal(child.provider, 'codex');
  assert.equal(child.cost_source, 'unknown');
  assert.equal(child.cost_usd, null, 'a provider without cost reports a gap, not $0');
  assert.equal(traces.grantParent(grant.endpoint.token), undefined, 'the grant link ends with the call');
  const month = new Date().toISOString().slice(0, 7);
  const lines = (await readFile(join(root, 'app', 'trace', `spans-${month}.jsonl`), 'utf8'))
    .trim()
    .split('\n');
  assert.equal(lines.length, 4);
  assert.equal((await traces.read('app', { task_id: 'other' })).length, 0);
});
