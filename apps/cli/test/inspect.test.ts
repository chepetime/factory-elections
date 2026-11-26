import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths, reviewDiagnose } from '../src/inspect.ts';

test('review diagnose reads each turn: exit, permission mode, tool calls, refused calls and result', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-inspect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'demo', 'reviews', '4');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'run.json'),
    JSON.stringify({
      url: 'u',
      branch: 'b',
      worktree: '/w',
      turns: [{ at: 'a', label: 'Review' }, { at: 'b' }],
    }),
  );
  await writeFile(join(dir, 'turn-0.exit'), '0\n');
  await writeFile(
    join(dir, 'turn-0.jsonl'),
    [
      {
        type: 'system',
        subtype: 'init',
        permissionMode: 'default',
        claude_code_version: '2.1.323',
        model: 'opus',
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use' }, { type: 'tool_use' }, { type: 'text' }] },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              is_error: true,
              content:
                "Claude requested permissions to write to payload.json, but you haven't granted it yet.",
            },
            { type: 'tool_result', is_error: true, content: 'grep: no such file' },
            { type: 'tool_result', content: 'ok' },
          ],
        },
      },
      'not json',
      { type: 'result', subtype: 'success', total_cost_usd: 0.79 },
    ]
      .map((l) => (typeof l === 'string' ? l : JSON.stringify(l)))
      .join('\n'),
  );
  const d = await reviewDiagnose(root, 'demo', 4);
  assert.equal(d.payload, null);
  assert.deepEqual(d.turns[0], {
    turn: 0,
    at: 'a',
    label: 'Review',
    exit: '0',
    permission_mode: 'default',
    cli_version: '2.1.323',
    model: 'opus',
    tool_calls: 2,
    failed_tool_calls: 2,
    refused: ["Claude requested permissions to write to payload.json, but you haven't granted it yet."],
    result: 'success',
    cost_usd: 0.79,
  });
  assert.equal(d.turns[1]!.exit, null, 'a turn without an exit file is still running or was cut');
  await assert.rejects(reviewDiagnose(root, 'demo', 5), /No review files/);
});

test('paths names the data root, lock and folders', () => {
  const p = paths('/data');
  assert.equal(p.data_root, '/data');
  assert.equal(p.reviews, '/data/<project>/reviews/<pr-number>');
});
