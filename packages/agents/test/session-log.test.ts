import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENTRY_LIMIT,
  RESULT_LIMIT,
  SessionLog,
  toolInput,
  transcriptDir,
  transcriptEntries,
} from '../src/session-log.ts';

test('a session log keeps messages, tool calls and capped results in order', () => {
  const log = new SessionLog([], () => '2026-11-25T00:00:00.000Z');
  log.run('Devin started');
  log.event({ type: 'text', text: 'Bumping the dependencies.' }, 'agent');
  log.event({ type: 'tool', name: 'Bash', input: { command: 'pnpm outdated' }, callId: 'c1' }, 'agent');
  log.event({ type: 'tool-result', ok: false, text: 'x'.repeat(RESULT_LIMIT + 10), callId: 'c1' });
  log.event({ type: 'text', text: '   ' });
  log.event({ type: 'context', tokens: 10 });
  assert.deepEqual(
    log.entries.map((e) => e.kind),
    ['run', 'text', 'tool', 'result'],
  );
  assert.deepEqual(log.entries[2], {
    at: '2026-11-25T00:00:00.000Z',
    kind: 'tool',
    tool: 'Bash',
    input: 'pnpm outdated',
    call: 'c1',
    step: 'agent',
  });
  const result = log.entries[3] as { text: string; ok: boolean };
  assert.equal(result.ok, false);
  assert.match(result.text, /10 more characters$/);
});

test('tool inputs read as their command, path or pattern, and the log stays bounded', () => {
  assert.equal(toolInput('Read', { file_path: '/w/a.ts' }), '/w/a.ts');
  assert.equal(toolInput('Grep', { pattern: 'TODO', path: 'src' }), 'TODO');
  assert.equal(toolInput('Other', { a: 1 }), '{"a":1}');
  const log = new SessionLog();
  for (let i = 0; i < ENTRY_LIMIT + 5; i++) log.run(`run ${i}`);
  assert.equal(log.entries.length, ENTRY_LIMIT);
  assert.equal((log.entries[0] as { text: string }).text, 'run 5');
});

test('an older run is rebuilt from Claude transcripts, oldest session first', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'factory-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cwd = '/data/demo/worktrees/abc';
  const dir = transcriptDir(cwd, home);
  assert.match(dir, /\.claude\/projects\/-data-demo-worktrees-abc$/);
  await mkdir(dir, { recursive: true });
  const line = (o: object) => JSON.stringify(o);
  await writeFile(
    join(dir, 'bbbbbbbb-2.jsonl'),
    [
      line({
        type: 'assistant',
        timestamp: '2026-11-25T02:00:00.000Z',
        message: { content: [{ type: 'text', text: 'Second session' }] },
      }),
    ].join('\n'),
  );
  await writeFile(
    join(dir, 'aaaaaaaa-1.jsonl'),
    [
      '{not json',
      line({
        type: 'assistant',
        timestamp: '2026-11-25T01:00:00.000Z',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm outdated' } }],
        },
      }),
      line({
        type: 'user',
        timestamp: '2026-11-25T01:00:05.000Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '41 outdated' }] },
      }),
    ].join('\n'),
  );
  const entries = await transcriptEntries(cwd, home);
  assert.deepEqual(
    entries.map((e) => e.kind),
    ['run', 'tool', 'result', 'run', 'text'],
  );
  assert.equal((entries[1] as { input: string }).input, 'pnpm outdated');
  assert.equal(entries[1]!.at, '2026-11-25T01:00:00.000Z');
  assert.deepEqual(await transcriptEntries('/nowhere', home), []);
});
