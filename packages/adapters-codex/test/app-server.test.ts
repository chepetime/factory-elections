// The app-server runner against a fake server (fake-app-server.mjs). Child start-up under
// `node --test` takes a while, so stall and startup limits stay at one second or more.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AgentEvent, ModelRun } from '@factory/core';
import {
  AppServerTurn,
  answerServerRequest,
  appServerArgs,
  CodexAppServerRunner,
  CodexAppServerStopped,
  CodexResumeRejected,
  CODEX_TOKEN_ENV,
  CodexRunError,
} from '../src/index.ts';

const FAKE = fileURLToPath(new URL('./fake-app-server.mjs', import.meta.url));
const THREAD = '01a20f38-4944-73f1-a9db-3e49869c9647';

async function setup(
  t: { after(fn: () => unknown): void },
  scenario: string,
  env: Record<string, string> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-app-server-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logFile = join(dir, 'log.jsonl');
  const runner = new CodexAppServerRunner({
    command: process.execPath,
    commandArgs: [FAKE],
    exitGraceMs: 300,
    interruptGraceMs: 1_000,
    stallCheckMs: 20,
  });
  const request = (extra: Partial<ModelRun> = {}): ModelRun => ({
    model: 'codex:gpt-test',
    effort: 'low',
    systemPrompt: 'Be brief.',
    prompt: 'Is it ok?',
    tools: 'read-only',
    cwd: dir,
    env: { FAKE_SCENARIO: scenario, FAKE_LOG: logFile, ...env },
    timeoutMs: 20_000,
    ...extra,
  });
  const log = async () =>
    (await readFile(logFile, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, any>);
  const sent = async () => (await log()).filter((e) => e.in).map((e) => e.in as Record<string, any>);
  return { runner, request, log, sent };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

for (const split of [false, true])
  test(`handshake and a streamed turn become events and a result${split ? ', with split frames and UTF-8' : ''}`, async (t) => {
    const { runner, request, sent, log } = await setup(t, 'turn', split ? { FAKE_SPLIT: '1' } : {});
    const events: AgentEvent[] = [];
    const schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' }, note: { type: 'string' } },
      required: ['ok'],
    };
    const result = await runner.run(
      request({
        outputSchema: schema,
        mcp: { url: 'http://127.0.0.1:1/mcp', token: 'secret' },
        onEvent: (e) => events.push(e),
      }),
    );
    assert.deepEqual(events, [
      { type: 'session', id: THREAD },
      { type: 'text', text: 'Café ☕ — looking.' },
      { type: 'tool', name: 'Bash', input: { command: "/bin/zsh -lc 'echo ok'" }, callId: 'exec-1' },
      { type: 'tool-result', ok: true, text: 'ok\n', callId: 'exec-1' },
      { type: 'text', text: '{"ok":true,"note":null}' },
      {
        type: 'result',
        ok: true,
        text: '',
        usage: { inputTokens: 100, outputTokens: 7, cachedInputTokens: 40 },
      },
    ]);
    assert.deepEqual(result, {
      text: '{"ok":true,"note":null}',
      structured: { ok: true },
      costUsd: null,
      sessionId: THREAD,
      usage: { inputTokens: 100, outputTokens: 7, cachedInputTokens: 40 },
    });
    const messages = await sent();
    assert.deepEqual(
      messages.map((m) => m.method),
      ['initialize', 'initialized', 'thread/start', 'turn/start'],
    );
    const [, , thread, turn] = messages;
    assert.deepEqual(thread!.params, {
      model: 'gpt-test',
      cwd: thread!.params.cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      developerInstructions: 'Be brief.',
    });
    assert.equal(turn!.params.effort, 'low');
    assert.equal(turn!.params.outputSchema.additionalProperties, false);
    assert.deepEqual(turn!.params.input, [{ type: 'text', text: 'Is it ok?', text_elements: [] }]);
    const start = (await log())[0]!;
    assert.deepEqual(start.argv.slice(0, 3), ['app-server', '--listen', 'stdio://']);
    assert.ok(start.argv.includes('mcp_servers.factory.url="http://127.0.0.1:1/mcp"'));
    assert.ok(
      (await log()).some((e) => e.stdin === 'closed'),
      'stdin closes after the turn',
    );
  });

test('app-server arguments keep the exec isolation that app-server accepts', () => {
  const args = appServerArgs({ mcp: { url: 'http://x/mcp', token: 't' } });
  assert.ok(!args.includes('--ignore-user-config'), 'app-server rejects --ignore-user-config');
  for (const feature of ['apps', 'browser_use', 'computer_use'])
    assert.ok(args.join(' ').includes(`--disable ${feature}`));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes(`mcp_servers.factory.bearer_token_env_var="${CODEX_TOKEN_ENV}"`));
  assert.ok(!args.join(' ').includes('"t"'), 'the token stays in the environment');
});

test('stderr, server-wide notices and repeated usage do not keep a stalled turn alive; stop escalates', async (t) => {
  const { runner, request, sent, log } = await setup(t, 'stall');
  const started = Date.now();
  const error = await runner.run(request({ stallMs: 1_000 })).then(
    () => assert.fail('the stalled turn must not succeed'),
    (e: unknown) => e,
  );
  assert.ok(error instanceof CodexAppServerStopped);
  assert.equal(error.kind, 'stalled');
  assert.deepEqual(error.interrupt, {
    sent: true,
    acknowledged: false,
    turnCompleted: false,
    descendantsSeen: 0,
    descendantsKilled: 0,
  });
  assert.equal(error.cleanup?.status, 'clean');
  assert.ok(Date.now() - started < 8_000);
  assert.ok((await sent()).some((m) => m.method === 'turn/interrupt' && m.params.turnId));
  const entries = await log();
  assert.ok(
    entries.some((e) => e.sigterm),
    'SIGTERM came after the interrupt and was ignored',
  );
  assert.ok(!alive(entries[0]!.pid), 'SIGKILL stopped the server');
});

test('an abort sends the native interrupt, and a descendant outside the group is found and stopped', async (t) => {
  const { runner, request, sent, log } = await setup(t, 'interrupt');
  const controller = new AbortController();
  const error = await runner
    .run(
      request({
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'tool') setTimeout(() => controller.abort(), 200);
        },
      }),
    )
    .then(
      () => assert.fail('the aborted turn must not succeed'),
      (e: unknown) => e,
    );
  assert.ok(error instanceof CodexAppServerStopped);
  assert.equal(error.kind, 'aborted');
  assert.deepEqual(error.interrupt, {
    sent: true,
    acknowledged: true,
    turnCompleted: true,
    descendantsSeen: 1,
    descendantsKilled: 1,
  });
  assert.equal(error.cleanup?.status, 'clean');
  const methods = (await sent()).map((m) => m.method);
  assert.deepEqual(methods.slice(-1), ['turn/interrupt']);
  const descendant = (await log()).find((e) => e.descendant)!.descendant as number;
  assert.ok(!alive(descendant));
});

test('a rejected resume is reported as such and never replaced by a new thread', async (t) => {
  const { runner, request, sent } = await setup(t, 'resume-rejected');
  const events: AgentEvent[] = [];
  const error = await runner.run(request({ resume: 'gone-thread', onEvent: (e) => events.push(e) })).then(
    () => assert.fail('the resume must fail'),
    (e: unknown) => e,
  );
  assert.ok(error instanceof CodexResumeRejected);
  assert.ok(error instanceof CodexRunError);
  assert.equal(error.kind, 'error');
  assert.equal(error.resumeRejected, true);
  assert.equal(error.sessionId, 'gone-thread');
  assert.match(error.message, /session gone-thread could not be resumed: .*no rollout found/);
  const methods = (await sent()).map((m) => m.method);
  assert.ok(!methods.includes('thread/start') && !methods.includes('turn/start'), methods.join());
  assert.deepEqual(events, []);
});

test('a resumed thread reports only this turn’s usage, not the earlier totals', () => {
  const turn = new AppServerTurn();
  const take = (m: object) => turn.take(m as never);
  take({ id: 2, result: { thread: { id: 't' } } });
  const total = (input: number, output: number, turnId: string) => ({
    method: 'thread/tokenUsage/updated',
    params: {
      threadId: 't',
      turnId,
      tokenUsage: { total: { inputTokens: input, outputTokens: output, cachedInputTokens: 0 } },
    },
  });
  assert.equal(take(total(1000, 70, 'old')).progress, true);
  take({ id: 3, result: { turn: { id: 'new' } } });
  assert.equal(take(total(1000, 70, 'old')).progress, false, 'an earlier turn is not this turn’s activity');
  assert.equal(take(total(1300, 80, 'new')).progress, true);
  assert.equal(take(total(1300, 80, 'new')).progress, false, 'a repeated snapshot is not progress');
  assert.deepEqual(turn.usage(), { inputTokens: 300, outputTokens: 10, cachedInputTokens: 0 });
  assert.equal(take({ method: 'account/rateLimits/updated', params: {} }).progress, false);
  assert.equal(take({ method: 'item/agentMessage/delta', params: { threadId: 'other' } }).progress, false);
});

test('a resume that fails in transport is not reported as a rejected session', async (t) => {
  const { runner, request } = await setup(t, 'silent');
  const slow = new CodexAppServerRunner({ ...runner.options, startupTimeoutMs: 1_000 });
  const error = await slow.run(request({ resume: THREAD })).then(
    () => assert.fail('the run must fail'),
    (e: unknown) => e,
  );
  assert.ok(error instanceof CodexRunError);
  assert.ok(!(error instanceof CodexResumeRejected));
  assert.equal(error.kind, 'error');
  assert.match(error.message, /did not answer initialize within 1000 ms/);
});

test('a server that exits during the turn is a transport failure with uncertain cleanup', async (t) => {
  const { runner, request } = await setup(t, 'exit-midturn');
  const error = await runner.run(request()).then(
    () => assert.fail('the run must fail'),
    (e: unknown) => e,
  );
  assert.ok(error instanceof CodexRunError && !(error instanceof CodexAppServerStopped));
  assert.match(error.message, /codex app-server ended \(exit 3\).*lost the model connection/s);
  assert.equal(error.cleanup?.status, 'uncertain');
});

test('approval requests are declined the same way each time; a guarded step is refused', async (t) => {
  const { runner, request, sent } = await setup(t, 'approval');
  const result = await runner.run(request());
  assert.equal(result.sessionId, THREAD);
  const answer = (await sent()).find((m) => m.id === 'srv-1');
  assert.deepEqual(answer, { id: 'srv-1', result: { decision: 'decline' } });
  assert.deepEqual(answerServerRequest('item/tool/requestUserInput'), {
    error: {
      code: -32601,
      message:
        'item/tool/requestUserInput is not supported: the factory runs Codex with approval policy never and does not answer prompts',
    },
  });
  await assert.rejects(
    runner.run(request({ guard: { check: () => undefined } })),
    /cannot screen each tool call/,
  );
});
