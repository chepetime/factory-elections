// Real Claude streams, captured and sanitized by scripts/capture-provider-fixtures.ts, replayed
// through the parsers. A provider format change shows here when the fixtures are captured again.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type AgentEvent, ToolSpans } from '@factory/core';
import { claudeMessageEvents, parseClaudeLine } from '../src/index.ts';

const lines = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter(Boolean);
const events = (name: string): AgentEvent[] =>
  name.startsWith('cli-')
    ? lines(name).flatMap(parseClaudeLine)
    : lines(name).flatMap((l) => claudeMessageEvents(JSON.parse(l) as Record<string, unknown>));
const session = (es: AgentEvent[]) => es.find((e) => e.type === 'session') as { id: string } | undefined;

for (const path of ['sdk', 'cli']) {
  test(`${path}: a tool turn pairs each tool result with its call id and ends with usage`, () => {
    const es = events(`${path}-tool-turn.jsonl`);
    const calls = es.filter((e) => e.type === 'tool');
    const results = es.filter((e) => e.type === 'tool-result');
    assert.ok(calls.length >= 1);
    assert.ok(calls.every((c) => c.callId));
    assert.deepEqual(
      results.map((r) => r.callId),
      calls.map((c) => c.callId),
    );
    const result = es.at(-1) as Extract<AgentEvent, { type: 'result' }>;
    assert.equal(result.type, 'result');
    assert.equal(result.ok, true);
    assert.ok(result.usage && result.usage.outputTokens > 0);
    assert.equal(typeof result.costUsd, 'number');

    const spans = new ToolSpans();
    for (const e of es) spans.event(e);
    assert.deepEqual(
      spans.finish().map((s) => [s.name, s.outcome]),
      [['Bash', 'completed']],
    );
  });

  test(`${path}: a resumed turn continues the same session`, () => {
    assert.equal(
      session(events(`${path}-resume-turn.jsonl`))?.id,
      session(events(`${path}-tool-turn.jsonl`))?.id,
    );
  });

  test(`${path}: a turn cancelled during a shell tool has a started call and no result`, () => {
    const es = events(`${path}-cancel-during-tool.jsonl`);
    assert.ok(es.some((e) => e.type === 'tool' && e.name === 'Bash'));
    assert.equal(
      es.some((e) => e.type === 'result'),
      false,
    );
  });
}
