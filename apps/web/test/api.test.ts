// Route handlers against a fake factory CLI script: no real data root, model or network.
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET as getProjects } from '@/app/api/projects/route';
import { GET as getTasks } from '@/app/api/projects/[project]/tasks/route';

const dir = mkdtempSync(join(tmpdir(), 'factory-web-'));

function fakeCli(body: string): string {
  const path = join(dir, `cli-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

const task = {
  id: '11111111-2222-4333-8444-555555555555',
  project: 'demo',
  repo: '/r',
  prompt: 'Do it',
  stage: 'queued',
};

afterEach(() => {
  delete process.env.FACTORY_CLI_SCRIPT;
});

const params = (project: string) => ({ params: Promise.resolve({ project }) });

describe('project and task read APIs', () => {
  it('returns validated projects from `project list`', async () => {
    process.env.FACTORY_CLI_SCRIPT = fakeCli(
      `if (process.argv.slice(2).join(' ') !== 'project list') process.exit(9);\nconsole.log(JSON.stringify([{ name: 'demo', repo: '/r' }]));`,
    );
    const res = await getProjects();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ name: 'demo', repo: '/r' }]);
  });

  it.each([
    ['relative script', 'relative/cli.mjs'],
    ['failing CLI', 'FAIL'],
    ['invalid JSON', 'BAD'],
    ['invalid records', 'INVALID'],
  ])('reports unavailable for a %s without leaking details', async (_name, kind) => {
    process.env.FACTORY_CLI_SCRIPT =
      kind === 'relative/cli.mjs'
        ? kind
        : fakeCli(
            kind === 'FAIL'
              ? `console.error('error: secret /Users/x path'); process.exit(1);`
              : kind === 'BAD'
                ? `console.log('nope')`
                : `console.log(JSON.stringify([{ name: 'bad name!' }]))`,
          );
    const res = await getProjects();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'project_source_unavailable' });
  });

  it('returns validated tasks and rejects invalid project names', async () => {
    process.env.FACTORY_CLI_SCRIPT = fakeCli(
      `if (process.argv.slice(2).join(' ') !== 'task list --project demo') process.exit(9);\nconsole.log(JSON.stringify([${JSON.stringify(task)}]));`,
    );
    const ok = await getTasks(new Request('http://127.0.0.1/'), params('demo'));
    expect(ok.status).toBe(200);
    expect((await ok.json())[0].id).toBe(task.id);
    const bad = await getTasks(new Request('http://127.0.0.1/'), params('bad name'));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_project' });
  });

  it('reports task source unavailable on CLI failure', async () => {
    process.env.FACTORY_CLI_SCRIPT = fakeCli(`process.exit(1)`);
    const res = await getTasks(new Request('http://127.0.0.1/'), params('demo'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'task_source_unavailable' });
  });
});
