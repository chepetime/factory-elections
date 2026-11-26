// The System and Functions queries: the newest spans of one type, and the catalog of MCP servers,
// tools and skills the factory gives its agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpanRecord } from '@factory/core';
import type { TraceLog } from '@factory/evidence';
import { skillFrontMatter, systemCatalog } from '../src/system-catalog.ts';
import { TaskTraces } from '../src/task-traces.ts';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
function span(
  project: string,
  name: string,
  type: SpanRecord['type'],
  ended: string,
  outcome = 'completed',
): SpanRecord {
  return {
    trace_id: 't',
    span_id: `${project}-${name}-${ended}`,
    type,
    name,
    project,
    started_at: ended,
    ended_at: ended,
    outcome: outcome as SpanRecord['outcome'],
    replay: { prompt: 'big' },
  } as SpanRecord;
}
const ledger = (spans: SpanRecord[]) => ({
  read: async (project: string, filter: { since?: string } = {}) =>
    spans.filter((s) => s.project === project && (!filter.since || s.ended_at >= filter.since)),
});

test('spans lists one type over every project, newest first, without replay inputs', async () => {
  const traces = ledger([
    span('a', 'Read', 'tool', ago(30)),
    span('b', 'Bash', 'tool', ago(10), 'failed'),
    span('a', 'claude', 'model', ago(5)),
    span('a', 'Old', 'tool', ago(60 * 24 * 30)),
  ]);
  const tt = new TaskTraces({
    root: '/none',
    tasks: { read: () => Promise.reject(new Error('unused')) },
    traces: traces as unknown as TraceLog,
    features: { read: () => Promise.reject(new Error('unused')) },
    projects: { list: async () => [{ name: 'a' }, { name: 'b' }] },
  });
  const tools = await tt.spans({ type: 'tool' });
  assert.deepEqual(
    tools.items.map((s) => s.name),
    ['Bash', 'Read'],
    'the 30-day-old span is outside the default 14 days',
  );
  assert.deepEqual([tools.total, tools.failed], [2, 1]);
  assert.equal('replay' in tools.items[0]!, false);
  const one = await tt.spans({ type: 'tool', project: 'a', limit: 1 });
  assert.deepEqual([one.items.map((s) => s.name), one.total], [['Read'], 1]);
  await assert.rejects(tt.spans({ type: 'nope' }));
});

test('the catalog lists the factory MCP server, factory and built-in tools with usage, and skills', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-catalog-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const factorySkills = join(base, 'skills');
  await mkdir(join(factorySkills, 'senior-pr-review'), { recursive: true });
  await writeFile(
    join(factorySkills, 'senior-pr-review', 'SKILL.md'),
    '---\nname: senior-pr-review\ndescription: "Review a PR."\nversion: 4.0.3\n---\n# Body\n',
  );
  const repo = join(base, 'repo');
  await mkdir(join(repo, '.claude', 'skills', 'tdd'), { recursive: true });
  await writeFile(join(repo, '.claude', 'skills', 'tdd', 'SKILL.md'), '---\ndescription: Test first.\n---\n');
  await mkdir(join(repo, '.codex', 'skills', 'tdd'), { recursive: true });
  await writeFile(join(repo, '.codex', 'skills', 'tdd', 'SKILL.md'), '---\ndescription: Copy.\n---\n');

  const catalog = await systemCatalog({
    projects: { list: async () => [{ name: 'app', repo }] },
    traces: ledger([
      span('app', 'Bash', 'tool', ago(1)),
      span('app', 'Bash', 'tool', ago(2), 'failed'),
      span('app', 'mcp__factory__comment', 'tool', ago(3)),
    ]),
    factorySkills,
  });
  assert.equal(catalog.mcp[0]?.name, 'factory');
  assert.ok(catalog.mcp[0]!.tools.includes('delegate'));
  assert.deepEqual(catalog.external_mcp, []);
  const tool = (name: string) => catalog.tools.find((x) => x.name === name);
  assert.deepEqual([tool('Bash')?.calls, tool('Bash')?.failed, tool('Bash')?.source], [2, 1, 'built-in']);
  assert.equal(tool('Bash')?.when, 'Steps with edit access');
  assert.equal(tool('Read')?.when, 'Steps with read-only or edit access');
  assert.deepEqual([tool('comment')?.source, tool('comment')?.calls], ['factory', 1]);
  assert.ok(tool('create_task'), 'chat tools are listed');
  assert.deepEqual(
    catalog.skills.map((s) => [s.owner, s.name, s.description, s.version]),
    [
      ['factory', 'senior-pr-review', 'Review a PR.', '4.0.3'],
      ['app', 'tdd', 'Test first.', undefined],
    ],
    'a skill name found in two repo folders shows once',
  );
});

test('skill front matter reads plain and quoted fields, and nothing without a block', () => {
  assert.deepEqual(skillFrontMatter("---\nname: 'x'\ndescription: Does y\n---\n"), {
    name: 'x',
    description: 'Does y',
  });
  assert.deepEqual(skillFrontMatter('# No front matter'), {});
});
