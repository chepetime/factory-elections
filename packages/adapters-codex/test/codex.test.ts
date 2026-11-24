import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CodexRunner,
  CODEX_TOKEN_ENV,
  dropOptionalNulls,
  execArgs,
  isCodexProtocolLine,
  parseCodexLine,
  strictSchema,
} from '../src/index.ts';

// Lines as `codex exec --json` 0.169 writes them.
const LINES = [
  '{"type":"thread.started","thread_id":"t-1"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Looking."}}',
  '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"a\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"{\\"ok\\":true}"}}',
  '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":7}}',
  'Reading additional input from stdin...',
];

test('codex JSONL becomes the shared events; a command shows once, when it starts', () => {
  assert.deepEqual(LINES.flatMap(parseCodexLine), [
    { type: 'session', id: 't-1' },
    { type: 'text', text: 'Looking.' },
    { type: 'tool', name: 'Bash', input: { command: '/bin/zsh -lc ls' }, callId: 'item_1' },
    { type: 'tool-result', ok: true, text: 'a\n', callId: 'item_1' },
    { type: 'text', text: '{"ok":true}' },
    {
      type: 'result',
      ok: true,
      text: '',
      usage: { inputTokens: 100, outputTokens: 7, cachedInputTokens: 40 },
    },
  ]);
  assert.deepEqual(parseCodexLine('{"type":"turn.failed","error":{"message":"usage limit"}}'), [
    { type: 'result', ok: false, text: 'usage limit' },
  ]);
});

test('exec arguments: sandbox by access, no user config, resume after the options, prompt last', () => {
  const args = execArgs({
    sandbox: 'read-only',
    effort: 'max',
    instructions: 'Say "hi"\nthen stop',
    mcp: { url: 'http://127.0.0.1:1/mcp', token: 'secret' },
    resume: 'thread-9',
    prompt: '--not-a-flag',
  });
  assert.deepEqual(args.slice(0, 6), [
    'exec',
    '--json',
    '--ignore-user-config',
    '--skip-git-repo-check',
    '-s',
    'read-only',
  ]);
  assert.ok(args.includes('model_reasoning_effort="xhigh"'));
  assert.ok(args.includes('developer_instructions="Say \\"hi\\"\\nthen stop"'));
  assert.ok(args.includes(`mcp_servers.factory.bearer_token_env_var="${CODEX_TOKEN_ENV}"`));
  assert.ok(!args.join(' ').includes('secret'), 'the token goes in the environment, not the arguments');
  assert.deepEqual(args.slice(-4), ['resume', 'thread-9', '--', '--not-a-flag']);
});

test('the runner returns structured output, session and usage, with no cost; a guarded step is refused', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-runner-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fake = join(dir, 'codex');
  await writeFile(
    fake,
    `#!/usr/bin/env node
process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(join(dir, 'seen.json'))}, JSON.stringify({ args: process.argv.slice(2), token: process.env.${CODEX_TOKEN_ENV} ?? null }));
const lines = ${JSON.stringify(LINES)};
for (const line of lines) console.log(line);
`,
  );
  await chmod(fake, 0o755);
  const runner = new CodexRunner({ command: fake });
  const events: string[] = [];
  const result = await runner.run({
    model: 'codex:gpt-test',
    effort: 'low',
    systemPrompt: 'Be brief.',
    prompt: 'Is it ok?',
    tools: 'read-only',
    outputSchema: { type: 'object' },
    mcp: { url: 'http://127.0.0.1:1/mcp', token: 'tok' },
    onEvent: (e) => events.push(e.type),
  });
  assert.deepEqual(result, {
    text: '{"ok":true}',
    structured: { ok: true },
    costUsd: null,
    sessionId: 't-1',
    usage: { inputTokens: 100, outputTokens: 7, cachedInputTokens: 40 },
  });
  assert.deepEqual(events, ['session', 'text', 'tool', 'tool-result', 'text', 'result']);
  const seen = JSON.parse(await readFile(join(dir, 'seen.json'), 'utf8')) as {
    args: string[];
    token: string;
  };
  assert.equal(seen.token, 'tok');
  assert.deepEqual(seen.args.slice(seen.args.indexOf('-m'), seen.args.indexOf('-m') + 2), ['-m', 'gpt-test']);
  assert.ok(seen.args.includes('--output-schema'));

  await assert.rejects(
    runner.run({
      model: 'codex',
      effort: 'low',
      systemPrompt: '',
      prompt: 'edit',
      tools: 'edit',
      guard: { check: () => undefined },
    }),
    /cannot screen each tool call/,
  );
});

test('step schemas become strict for OpenAI, and optional fields left null are dropped again', () => {
  const schema = {
    type: 'object',
    required: ['verdict', 'findings'],
    properties: {
      verdict: { type: 'string' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' }, file: { type: 'string' } },
        },
      },
    },
  };
  const strict = strictSchema(schema) as any;
  assert.equal(strict.additionalProperties, false);
  assert.deepEqual(strict.properties.findings.items.required, ['message', 'file']);
  assert.deepEqual(strict.properties.findings.items.properties.file, {
    anyOf: [{ type: 'string' }, { type: 'null' }],
  });
  assert.equal(strict.properties.findings.items.additionalProperties, false);
  assert.deepEqual(
    dropOptionalNulls(
      {
        verdict: 'approve',
        findings: [
          { message: 'm', file: null },
          { message: 'n', file: 'a.ts' },
        ],
      },
      schema,
    ),
    { verdict: 'approve', findings: [{ message: 'm' }, { message: 'n', file: 'a.ts' }] },
  );
});

test('stderr noise and non-protocol stdout do not keep a stalled Codex turn alive', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-stall-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fake = join(dir, 'codex');
  await writeFile(
    fake,
    // One protocol event, then only diagnostics: stderr noise and a non-JSON stdout line, forever.
    `#!/bin/sh
echo '{"type":"thread.started","thread_id":"t-1"}'
while :; do echo 'WARN retrying telemetry' >&2; echo 'not json'; sleep 0.01; done
`,
  );
  await chmod(fake, 0o755);
  const runner = new CodexRunner({ command: fake, stallCheckMs: 10 });
  // The stall limit is well above process startup; the timeout bounds a turn that never stalls.
  await assert.rejects(
    runner.run({
      model: 'codex',
      effort: 'low',
      systemPrompt: '',
      prompt: 'x',
      tools: 'read-only',
      stallMs: 1_000,
      timeoutMs: 6_000,
    }),
    (e: Error & { kind?: string }) => e.kind === 'stalled',
  );
});

test('a stdout line is protocol only when it is a JSON object with a type', () => {
  assert.equal(isCodexProtocolLine('{"type":"turn.started"}'), true);
  assert.equal(isCodexProtocolLine('Reading additional input from stdin...'), false);
  assert.equal(isCodexProtocolLine('{"no":"type"}'), false);
  assert.equal(isCodexProtocolLine('42'), false);
});
