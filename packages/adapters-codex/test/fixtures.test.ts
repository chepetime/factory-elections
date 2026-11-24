// Real `codex exec --json` and `codex app-server` streams, captured and sanitized by
// scripts/capture-provider-fixtures.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type AgentEvent, ToolSpans } from '@factory/core';
import { AppServerTurn, isCodexProtocolLine, parseAppServerLine, parseCodexLine } from '../src/index.ts';

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

/** Replays an app-server stdout capture through the runner's reader. */
function replay(name: string) {
  const turn = new AppServerTurn();
  const events: AgentEvent[] = [];
  for (const line of lines(name)) {
    const m = parseAppServerLine(line);
    assert.ok(m, `${name}: every stdout line is a JSON-RPC message`);
    events.push(...turn.take(m).events);
  }
  return { turn, events };
}

test('a real app-server tool turn pairs the command with its result by item id and ends with usage', () => {
  const { events, turn } = replay('app-server-tool-turn.jsonl');
  assert.equal(events[0]?.type, 'session');
  const calls = events.filter((e) => e.type === 'tool');
  const results = events.filter((e) => e.type === 'tool-result');
  assert.ok(calls.length >= 1 && calls.every((c) => c.callId));
  assert.deepEqual(
    results.map((r) => r.callId),
    calls.map((c) => c.callId),
  );
  const result = events.at(-1) as Extract<AgentEvent, { type: 'result' }>;
  assert.equal(result.type, 'result');
  assert.ok(result.ok && result.usage && result.usage.inputTokens > 0);
  assert.equal(turn.status, 'completed');
  assert.ok(turn.text);
  const spans = new ToolSpans();
  for (const e of events) spans.event(e);
  assert.deepEqual(
    spans.finish().map((s) => [s.name, s.outcome]),
    [['Bash', 'completed']],
  );
});

test('a resumed real app-server turn keeps the thread and counts only its own usage', () => {
  const first = replay('app-server-tool-turn.jsonl');
  const second = replay('app-server-resume-turn.jsonl');
  assert.ok(first.turn.threadId);
  assert.equal(second.turn.threadId, first.turn.threadId);
  const totals = lines('app-server-resume-turn.jsonl')
    .map(parseAppServerLine)
    .filter((m) => m?.method === 'thread/tokenUsage/updated')
    .map((m) => (m!.params!.tokenUsage as { total: { inputTokens: number } }).total.inputTokens);
  const usage = second.turn.usage()!;
  assert.ok(usage.inputTokens > 0);
  assert.equal(
    usage.inputTokens,
    totals.at(-1)! - totals[0]!,
    'thread total now minus the total before the turn',
  );
});

test('a real resume of a missing thread is a JSON-RPC error, not a new thread', () => {
  const messages = lines('app-server-resume-rejected.jsonl').map(parseAppServerLine);
  const answer = messages.find((m) => m?.id === 2);
  assert.equal(answer?.error?.code, -32600);
  assert.match(answer?.error?.message ?? '', /no rollout found/);
  assert.deepEqual(replay('app-server-resume-rejected.jsonl').events, []);
});

test('a real interrupted app-server turn shows the started command, no result for it, and an interrupted end', () => {
  const { events, turn } = replay('app-server-cancel-during-tool.jsonl');
  assert.ok(events.some((e) => e.type === 'tool' && e.name === 'Bash' && e.callId));
  assert.ok(!events.some((e) => e.type === 'tool-result'));
  assert.equal(turn.status, 'interrupted');
  const result = events.at(-1) as Extract<AgentEvent, { type: 'result' }>;
  assert.deepEqual([result.type, result.ok], ['result', false]);
});
