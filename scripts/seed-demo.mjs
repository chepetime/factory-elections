#!/usr/bin/env node
// Fills a worktree's own backend with demo data, so its pages show realistic content without the
// shared live backend: a `demo` project on a throwaway git repo, tickets in several states with
// priorities, dates, comments and a creator, and one saved PR review with findings.
// Run it while `pnpm worktree run <web> <backend>` serves this checkout:
//   FACTORY_BACKEND_PORT=<backend> node scripts/seed-demo.mjs
// It refuses the default data root, so it never writes into the real factory data.
import './load-env.ts';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendCall, closeBackendClient } from '../packages/backend-client/src/client.ts';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const root = resolve(process.env.FACTORY_ROOT ?? join(repoRoot, '.turri', 'worktree-data'));
if (root === resolve(homedir(), '.local', 'share', 'factory'))
  throw new Error(`Refusing to seed the default data root ${root}. Use a worktree's own data root.`);
process.env.FACTORY_ROOT = root;
process.env.FACTORY_BACKEND_ADDRESS ??= `127.0.0.1:${process.env.FACTORY_BACKEND_PORT ?? 4320}`;

const call = async (method, request) => {
  const reply = await backendCall(method, request, 30_000);
  return reply.json === undefined ? reply.text : JSON.parse(reply.json);
};
const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function main() {
  // A throwaway repo with one commit: enough for a project; agents are never started here.
  const demoRepo = join(root, 'demo-repo');
  mkdirSync(demoRepo, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: demoRepo, stdio: 'pipe' });
  try {
    git('rev-parse', 'HEAD');
  } catch {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(demoRepo, 'README.md'), '# Demo\n');
    git('add', '.');
    git('-c', 'user.name=demo', '-c', 'user.email=demo@example.com', 'commit', '-qm', 'init');
  }
  const projects = await call('ListProjects', {});
  if (!projects.some((p) => p.name === 'demo')) await call('AddProject', { name: 'demo', repo: demoRepo });

  const tickets = [
    { title: 'Show the vote count on each race card', priority: 'high', status: 'todo', start: -2, due: 3 },
    {
      title: 'Fix the overlap of the filter bar on small screens',
      priority: 'urgent',
      status: 'todo',
      due: -1,
    },
    { title: 'Add a candidate comparison page', priority: 'medium', status: 'backlog', start: 4, due: 14 },
    { title: 'Write tests for the ballot parser', priority: 'low', status: 'backlog', by: 'mika' },
    { title: 'Update the copy on the landing page', priority: 'none', status: 'done' },
    { title: 'Remove the old feature flag', priority: 'none', status: 'cancelled' },
  ];
  const existing = await call('ListIssues', { project: 'demo', id: '' });
  const titles = new Set((Array.isArray(existing) ? existing : (existing.items ?? [])).map((i) => i.title));
  for (const t of tickets) {
    if (titles.has(t.title)) continue;
    const issue = await call('CreateIssue', {
      project: 'demo',
      json: JSON.stringify({
        title: t.title,
        description: `## Goal\n\n${t.title}.\n\n## Acceptance criteria\n\n- It works on mobile.\n- Tests cover it.`,
        status: t.status === 'backlog' ? 'backlog' : 'todo',
        priority: t.priority,
        ...(t.by ? { created_by: t.by } : {}),
      }),
    });
    const dates = {
      ...(t.start !== undefined ? { start_date: days(t.start) } : {}),
      ...(t.due !== undefined ? { due_date: days(t.due) } : {}),
    };
    if (Object.keys(dates).length)
      await call('UpdateIssue', { project: 'demo', json: JSON.stringify({ key: issue.key, ...dates }) });
    if (t.status === 'done' || t.status === 'cancelled')
      await call('MoveIssue', { project: 'demo', json: JSON.stringify({ key: issue.key, to: t.status }) });
    await call('CommentIssue', {
      project: 'demo',
      json: JSON.stringify({ key: issue.key, body: 'Seeded demo comment: check the design first.' }),
    });
  }

  // One saved review with findings, for the Findings and PR review pages. Files only: no agent ran.
  const reviewDir = join(root, 'demo', 'reviews', '1');
  mkdirSync(reviewDir, { recursive: true });
  const at = new Date().toISOString();
  writeFileSync(
    join(reviewDir, 'run.json'),
    JSON.stringify({
      number: 1,
      branch: 'demo/race-card',
      url: 'https://github.com/example/demo/pull/1',
      title: 'Show the vote count on each race card',
      worktree: join(root, 'demo-review-worktree'),
      started_at: at,
      turns: [{ at, text: 'Review PR #1.', label: 'Review', stopped: true }],
    }),
  );
  writeFileSync(
    join(reviewDir, 'payload.json'),
    JSON.stringify({
      meta: {
        decision: 'request-changes',
        risk_level: 'medium',
        pr_title: 'Show the vote count on each race card',
      },
      findings: [
        {
          severity: 'must-fix',
          axis: 'correctness',
          title: 'The count reads the stale cache after a refresh',
          file: 'src/race-card.tsx',
          line_range: '40-52',
          fix: 'Read the count from the query result, not the cache.',
        },
        { severity: 'should-fix', axis: 'standards', title: 'Name the helper after what it returns' },
      ],
    }),
  );
  closeBackendClient();
  console.log(`Seeded project demo in ${root}: ${tickets.length} tickets and one PR review.`);
}

main().catch((error) => {
  closeBackendClient();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
