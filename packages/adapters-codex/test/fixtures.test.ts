// Real `codex exec --json` streams, captured and sanitized by scripts/capture-provider-fixtures.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type AgentEvent, ToolSpans } from '@factory/core';
import { isCodexProtocolLine, parseCodexLine } from '../src/index.ts';

const lines = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter(Boolean);

test('every stdout line of a real turn is a protocol event', () => {
  for (const name of ['exec-tool-turn.jsonl', 'exec-resume-turn.jsonl'])
    assert.ok(lines(name).every(isCodexProtocolLine), name);
});

test('a real tool turn pairs the command with its result by item id and ends with usage', () => {
  const es: AgentEvent[] = lines('exec-tool-turn.jsonl').flatMap(parseCodexLine);
  const calls = es.filter((e) => e.type === 'tool');
  const results = es.filter((e) => e.type === 'tool-result');
  assert.ok(calls.length >= 1 && calls.every((c) => c.callId));
  assert.deepEqual(
    results.map((r) => r.callId),
    calls.map((c) => c.callId),
  );
  const result = es.at(-1) as Extract<AgentEvent, { type: 'result' }>;
  assert.equal(result.type, 'result');
  assert.ok(result.ok && result.usage && result.usage.inputTokens > 0);
  const spans = new ToolSpans();
  for (const e of es) spans.event(e);
  assert.deepEqual(
    spans.finish().map((s) => [s.name, s.outcome]),
    [['Bash', 'completed']],
  );
});

test('a resumed real turn reports the same thread', () => {
  const thread = (name: string) =>
    (
      lines(name)
        .flatMap(parseCodexLine)
        .find((e) => e.type === 'session') as { id: string } | undefined
    )?.id;
  assert.ok(thread('exec-tool-turn.jsonl'));
  assert.equal(thread('exec-resume-turn.jsonl'), thread('exec-tool-turn.jsonl'));
});
