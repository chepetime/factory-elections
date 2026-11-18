import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeCli, parseClaudeLine } from '../src/index.ts';

test('Claude stream-json becomes the shared events, marking subagent output', () => {
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
    JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'gh pr view 1' } }] },
    }),
    JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: 'tool-1',
      message: { content: [{ type: 'text', text: 'sub noise' }] },
    }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Approve',
      total_cost_usd: 2,
      session_id: 's1',
      usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 4 },
    }),
    'not json',
  ];
  assert.deepEqual(lines.flatMap(parseClaudeLine), [
    { type: 'session', id: 's1' },
    { type: 'tool', name: 'Bash', input: { command: 'gh pr view 1' } },
    { type: 'text', text: 'sub noise', sub: true },
    {
      type: 'result',
      ok: true,
      text: 'Approve',
      costUsd: 2,
      sessionId: 's1',
      usage: { inputTokens: 14, outputTokens: 3, cachedInputTokens: 4 },
    },
  ]);
});

test('a turn that may delegate gets the backend MCP server, with its token in a header', () => {
  const args = claudeCli.args(
    {
      message: 'hi',
      systemPromptFile: '/p.md',
      deny: [],
      mcp: { url: 'http://127.0.0.1:9/mcp', token: 'tok' },
    },
    { systemPrompt: '' },
  );
  const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]!) as {
    mcpServers: { factory: { type: string; url: string; headers: Record<string, string> } };
  };
  assert.deepEqual(config.mcpServers.factory, {
    type: 'http',
    url: 'http://127.0.0.1:9/mcp',
    headers: { Authorization: 'Bearer tok' },
  });
  assert.deepEqual(args.slice(-2), ['--', 'hi']);
});
