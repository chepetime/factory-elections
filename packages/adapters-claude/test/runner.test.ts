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
  assert.deepEqual(seen[0]!.skills, [], 'no skill the step did not choose');
  assert.deepEqual(seen[0]!.extraArgs, { 'disable-slash-commands': null });
  assert.ok(seen[0]!.abortController instanceof AbortController);
});

test("a call loads only the MCP servers it names, never the account's claude.ai connectors", async () => {
  const seen: Record<string, any>[] = [];
  const runner = new ClaudeAgentRunner({ query: fake([success()], 0, seen) });
  await runner.run({ ...request, tools: 'edit' });
  assert.equal(seen[0]!.strictMcpConfig, true, 'no MCP server from any config the step did not pass');
  // Connectors on the signed-in claude.ai account load even with settingSources: [] and once filled
  // most of a 150k agent context with their tool definitions before the agent read any code.
  assert.equal(seen[0]!.env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
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

test('a rate limit after model output or a tool call is not retried, even at zero or unknown cost', async () => {
  const limited = {
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    errors: ['429 rate_limit_error'],
  };
  const toolTurn = {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git push' } }] },
  };
  const textTurn = { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } };
  for (const [before, cost] of [
    [toolTurn, 0],
    [toolTurn, undefined],
    [textTurn, undefined],
  ] as const) {
    let calls = 0;
    const query = ((...args: unknown[]) => {
      calls++;
      const end = cost === undefined ? limited : { ...limited, total_cost_usd: cost };
      return (fake([before, end]) as (...a: unknown[]) => unknown)(...args);
    }) as unknown as Query;
    const runner = new ClaudeAgentRunner({ query, retryDelaysMs: [5] });
    await assert.rejects(runner.run(request), (e: ModelRunError) => e.kind === 'rate-limited');
    assert.equal(calls, 1);
  }
});

test('a rate limit with unknown cost and no activity is retried', async () => {
  let calls = 0;
  const query = ((...args: unknown[]) => {
    calls++;
    return (
      fake(
        calls === 1
          ? [
              {
                type: 'result',
                subtype: 'error_during_execution',
                is_error: true,
                errors: ['429 rate_limit_error'],
              },
            ]
          : [success()],
      ) as (...a: unknown[]) => unknown
    )(...args);
  }) as unknown as Query;
  const runner = new ClaudeAgentRunner({ query, retryDelaysMs: [5] });
  assert.equal((await runner.run(request)).text, 'done');
  assert.equal(calls, 2);
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

test('loop guard and context warning reach the agent through SDK hooks; the judge cost joins the call', async () => {
  const notes: string[] = [];
  const statuses: boolean[] = [];
  let calls = 0;
  const query = ((args: { options: Record<string, any> }) => {
    calls++;
    const options = args.options;
    return (async function* () {
      if (calls > 1) {
        // The judge: a small structured call.
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '',
          total_cost_usd: 0.002,
          structured_output: { stuck: true, confidence: 0.9, redirect: 'Install tsc first.' },
        };
        return;
      }
      yield {
        type: 'assistant',
        message: {
          content: [],
          usage: { input_tokens: 10, cache_read_input_tokens: 125_000, cache_creation_input_tokens: 0 },
        },
      };
      const failure = options.hooks.PostToolUseFailure[0].hooks[0];
      for (let i = 0; i < 3; i++) {
        const out = await failure(
          {
            hook_event_name: 'PostToolUseFailure',
            tool_name: 'Bash',
            tool_input: { command: 'npm run build' },
            error: 'tsc: not found',
            tool_use_id: `t${i}`,
          },
          `t${i}`,
          { signal: new AbortController().signal },
        );
        if (out.hookSpecificOutput?.additionalContext) notes.push(out.hookSpecificOutput.additionalContext);
      }
      yield { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.1 };
    })();
  }) as unknown as Query;
  const runner = new ClaudeAgentRunner({ query });
  const result = await runner.run({
    ...request,
    tools: 'edit',
    loopGuard: true,
    context: { limit: 150_000, onStatus: (s) => statuses.push(s.warn) },
  });
  assert.deepEqual(statuses, [true], 'one warning at 80% of the limit');
  assert.match(
    notes[0]!,
    /Context is 125k tokens, 83% of the 150k limit/,
    'the agent hears the warning on the next tool result',
  );
  assert.match(notes.at(-1)!, /loop guard: the same failure has repeated 3 times\. Install tsc first\./);
  assert.equal(result.costUsd, 0.1 + 0.002);
});

test('a call gets the agent allowlist plus its extra environment, never other host secrets', async (t) => {
  process.env.FACTORY_DATABASE_URL = 'postgres://u:secret@db';
  process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
  process.env.OPENAI_API_KEY = 'other-provider';
  process.env.TOOL_HOME = '/opt/tool';
  t.after(() => {
    for (const k of ['FACTORY_DATABASE_URL', 'AWS_SECRET_ACCESS_KEY', 'OPENAI_API_KEY', 'TOOL_HOME'])
      delete process.env[k];
  });
  const seen: Record<string, unknown>[] = [];
  const runner = new ClaudeAgentRunner({ query: fake([success()], 0, seen) });
  await runner.run({ ...request, env: { NPM_CONFIG_USERCONFIG: '/tmp/x/.npmrc' }, passEnv: ['TOOL_HOME'] });
  const env = seen[0]!.env as Record<string, string>;
  assert.equal(env.NPM_CONFIG_USERCONFIG, '/tmp/x/.npmrc');
  assert.equal(env.PATH, process.env.PATH, 'tools are still found');
  assert.equal(env.TOOL_HOME, '/opt/tool', 'a profile may pass a named variable');
  for (const k of ['FACTORY_DATABASE_URL', 'AWS_SECRET_ACCESS_KEY', 'OPENAI_API_KEY'])
    assert.equal(env[k], undefined, `${k} must not reach the agent`);
});

/** A stream that fails on its first read, as a crashed CLI does. */
function failing(message: string): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(new Error(message)),
    }),
  };
}

test('a stream that ends with no result, and a stream error with no other cause, are no-result', async () => {
  const ended = new ClaudeAgentRunner({ query: fake([]) });
  await assert.rejects(
    ended.run(request),
    (e: ModelRunError) => e.kind === 'no-result' && /ended without a result/.test(e.message),
  );
  const crashed = failing('Claude Code process exited with code 1');
  const crash = new ClaudeAgentRunner({ query: (() => crashed) as unknown as Query });
  await assert.rejects(
    crash.run(request),
    (e: ModelRunError) => e.kind === 'no-result' && /model run failed: .*exited with code 1/.test(e.message),
  );
});

test('a stream error that names a rate limit keeps its own kind', async () => {
  const limited = failing('429 too many requests');
  const runner = new ClaudeAgentRunner({ query: (() => limited) as unknown as Query, retryDelaysMs: [] });
  await assert.rejects(runner.run(request), (e: ModelRunError) => e.kind === 'rate-limited');
});

const toolStart = {
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'sleep 9' } }] },
};
const toolEnd = {
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
};

/** Yields each message after its own delay, and honours abort. */
function timed(steps: [number, unknown][]): Query {
  return ((args: { options: { abortController?: AbortController } }) => {
    const signal = args.options.abortController!.signal;
    return (async function* () {
      for (const [gap, m] of steps) {
        await new Promise<void>((done, fail) => {
          const t = setTimeout(done, gap);
          signal.addEventListener('abort', () => (clearTimeout(t), fail(new Error('aborted'))), {
            once: true,
          });
        });
        yield m;
      }
    })();
  }) as unknown as Query;
}

test('a tool call open longer than the stall limit, but within the open-tool limit, completes', async () => {
  const runner = new ClaudeAgentRunner({
    query: timed([
      [0, toolStart],
      [150, toolEnd],
      [0, success()],
    ]),
    stallCheckMs: 10,
    openToolStallMs: 400,
  });
  assert.equal((await runner.run({ ...request, stallMs: 50 })).text, 'done');
});

test('a tool call open past the open-tool limit stops as stalled and names the tool', async () => {
  const runner = new ClaudeAgentRunner({
    query: timed([
      [0, toolStart],
      [5_000, toolEnd],
    ]),
    stallCheckMs: 10,
    openToolStallMs: 120,
  });
  await assert.rejects(
    runner.run({ ...request, stallMs: 50 }),
    (e: ModelRunError) => e.kind === 'stalled' && /open tool: Bash/.test(e.message),
  );
});

test('silence after the tool result closed the call still stalls at the stall limit', async () => {
  const runner = new ClaudeAgentRunner({
    query: timed([
      [0, toolStart],
      [0, toolEnd],
      [5_000, success()],
    ]),
    stallCheckMs: 10,
    openToolStallMs: 5_000,
  });
  await assert.rejects(
    runner.run({ ...request, stallMs: 50 }),
    (e: ModelRunError) => e.kind === 'stalled' && !/open tool/.test(e.message),
  );
});
