// The runner's limits, with a fake SDK query: no model is called.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelRun } from '@factory/core';
import { ClaudeAgentRunner, ModelRunError } from '../src/index.ts';

type Query = NonNullable<ConstructorParameters<typeof ClaudeAgentRunner>[0]>['query'];
const request: ModelRun = {
  step: 'coder',
  model: 'claude-sonnet-5-5',
  effort: 'low',
  systemPrompt: '',
  prompt: 'x',
  tools: 'none',
};

function success(cost = 0.1) {
  return { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: cost };
}

/** A fake query that yields the given messages, waiting `gapMs` before each, and honours abort. */
function fake(messages: unknown[], gapMs = 0, seen: unknown[] = []): Query {
  return ((args: { options: { abortController?: AbortController } }) => {
    seen.push(args.options);
    const signal = args.options.abortController!.signal;
    return (async function* () {
      for (const m of messages) {
        await new Promise<void>((done, fail) => {
          const t = setTimeout(done, gapMs);
          signal.addEventListener('abort', () => (clearTimeout(t), fail(new Error('aborted by user'))), {
            once: true,
          });
        });
        yield m;
      }
    })();
  }) as unknown as Query;
}

test('a call passes its budget and abort controller to the SDK', async () => {
  const seen: Record<string, unknown>[] = [];
  const runner = new ClaudeAgentRunner({ query: fake([success()], 0, seen) });
  const result = await runner.run({ ...request, maxBudgetUsd: 2 });
  assert.equal(result.costUsd, 0.1);
  assert.equal(seen[0]!.maxBudgetUsd, 2);
  assert.ok(seen[0]!.abortController instanceof AbortController);
});

test('a call with no message within the stall limit stops as stalled', async () => {
  const runner = new ClaudeAgentRunner({ query: fake([success()], 5_000), stallCheckMs: 10 });
  await assert.rejects(runner.run({ ...request, stallMs: 50 }), (e: ModelRunError) => e.kind === 'stalled');
});

test('a call stops at its time limit, and at once when the run is aborted', async () => {
  const slow = new ClaudeAgentRunner({ query: fake([success()], 5_000) });
  await assert.rejects(slow.run({ ...request, timeoutMs: 50 }), (e: ModelRunError) => e.kind === 'timeout');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    slow.run({ ...request, signal: controller.signal }),
    (e: ModelRunError) => e.kind === 'aborted',
  );
});

test('a rate limit before any spend is retried; one after spend is not', async () => {
  let calls = 0;
  const limited = {
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    errors: ['429 rate_limit_error'],
  };
  const query = ((...args: unknown[]) => {
    calls++;
    return (
      fake(calls === 1 ? [{ ...limited, total_cost_usd: 0 }] : [success()]) as (...a: unknown[]) => unknown
    )(...args);
  }) as unknown as Query;
  const runner = new ClaudeAgentRunner({ query, retryDelaysMs: [5] });
  assert.equal((await runner.run(request)).text, 'done');
  assert.equal(calls, 2);

  calls = 0;
  const spent = new ClaudeAgentRunner({
    query: fake([{ ...limited, total_cost_usd: 0.4 }]),
    retryDelaysMs: [5],
  });
  await assert.rejects(
    spent.run(request),
    (e: ModelRunError) => e.kind === 'rate-limited' && e.costUsd === 0.4,
  );
});

test('a budget stop and a usage limit are reported as such, with their cost', async () => {
  const budget = new ClaudeAgentRunner({
    query: fake([
      { type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: [], total_cost_usd: 2 },
    ]),
  });
  await assert.rejects(budget.run(request), (e: ModelRunError) => e.kind === 'budget' && e.costUsd === 2);
  const usage = new ClaudeAgentRunner({
    query: fake([
      { type: 'result', subtype: 'success', is_error: true, result: "You've hit your limit · resets 5pm" },
    ]),
  });
  await assert.rejects(usage.run(request), (e: ModelRunError) => e.kind === 'usage-limit');
});

test('the coder may start subagents, and the step guard screens their tool calls too', async () => {
  const seen: {
    canUseTool: (name: string, input: Record<string, unknown>, o: unknown) => Promise<{ behavior: string }>;
    tools: string[];
  }[] = [];
  const runner = new ClaudeAgentRunner({ query: fake([success()], 0, seen) });
  await runner.run({
    ...request,
    tools: 'edit',
    guard: {
      check: (_name, input) =>
        String(input.file_path).startsWith('/etc') ? 'outside the worktree' : undefined,
    },
  });
  const { canUseTool, tools } = seen[0]!;
  assert.ok(tools.includes('Agent'));
  const fromSubagent = { signal: new AbortController().signal, toolUseID: 't1', agentID: 'a1' };
  assert.equal((await canUseTool('Write', { file_path: '/etc/passwd' }, fromSubagent)).behavior, 'deny');
  assert.equal((await canUseTool('Write', { file_path: 'src/a.ts' }, fromSubagent)).behavior, 'allow');
  assert.equal((await canUseTool('WebFetch', { url: 'https://x' }, fromSubagent)).behavior, 'deny');
});
