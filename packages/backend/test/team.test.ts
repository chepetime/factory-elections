import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storageFor } from '@factory/adapters-data';
import { TeamService } from '../src/team.ts';

const exec = promisify(execFile);

test('bulk edits preserve untouched fields; identity merges persist and combine historical and future commits', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-team-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'data');
  await exec('git', ['init', base]);
  const commit = async (name: string, email: string, date: string) => {
    await exec(
      'git',
      ['-C', base, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture'],
      {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: name,
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_NAME: name,
          GIT_COMMITTER_EMAIL: email,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
      },
    );
  };
  await commit('Alice Old', 'old@example.test', '2026-01-01T12:00:00Z');
  await commit('Bob', 'bob@example.test', '2026-02-01T12:00:00Z');
  await commit('Alice', 'alice@example.test', '2026-03-01T12:00:00Z');
  await commit('Alice', 'alice@example.test', '2026-04-01T12:00:00Z');
  await storageFor(root).projects.add('app', base);
  const service = new TeamService(root);
  const bulk = (input: unknown) => service.bulk({ project: 'app', json: JSON.stringify(input) });
  await service.assign({ project: 'app', email: 'alice@example.test', team: 'Platform', tags: ['lead'] });
  await service.assign({ project: 'app', email: 'old@example.test', team: 'Legacy', tags: ['frontend'] });
  const edited = await bulk({
    kind: 'edit',
    emails: ['alice@example.test', 'old@example.test'],
    team: 'Engineering',
  });
  assert.equal(edited.find((m) => m.email === 'alice@example.test')?.team, 'Engineering');
  assert.deepEqual(edited.find((m) => m.email === 'old@example.test')?.tags, ['frontend']);
  await bulk({ kind: 'edit', emails: ['old@example.test'], tags: ['legacy', 'legacy'] });
  const beforeInvalid = await service.members('app');
  await assert.rejects(
    bulk({ kind: 'edit', emails: ['alice@example.test', 'missing@example.test'], team: 'Oops' }),
    /selected members changed/,
  );
  await assert.rejects(bulk({ kind: 'edit', emails: ['alice@example.test'], tags: ['x'.repeat(31)] }));
  await assert.rejects(bulk({ kind: 'edit', emails: ['alice@example.test'] }));
  assert.deepEqual(await service.members('app'), beforeInvalid);
  await assert.rejects(
    bulk({ kind: 'merge', emails: ['alice@example.test', 'old@example.test'], primary: 'bob@example.test' }),
    /identity to keep/,
  );
  await service.assign({
    project: 'app',
    email: 'alice@example.test',
    team: 'Engineering',
    tags: Array.from({ length: 12 }, (_, i) => `tag-${i}`),
  });
  await assert.rejects(
    bulk({
      kind: 'merge',
      emails: ['alice@example.test', 'old@example.test'],
      primary: 'alice@example.test',
    }),
    /more than 12/,
  );
  assert.equal((await service.members('app')).length, 3);
  await service.assign({ project: 'app', email: 'alice@example.test', team: 'Engineering', tags: ['lead'] });
  const merged = await bulk({
    kind: 'merge',
    emails: ['alice@example.test', 'old@example.test'],
    primary: 'alice@example.test',
  });
  assert.equal(merged.length, 2);
  const alice = merged.find((m) => m.email === 'alice@example.test')!;
  assert.equal(alice.name, 'Alice');
  assert.equal(alice.commits, 3);
  assert.equal(Date.parse(alice.firstCommit), Date.parse('2026-01-01T12:00:00Z'));
  assert.equal(Date.parse(alice.lastCommit), Date.parse('2026-04-01T12:00:00Z'));
  assert.equal(alice.team, 'Engineering');
  assert.deepEqual(alice.tags.sort(), ['lead', 'legacy']);
  assert.deepEqual(alice.aliases, ['old@example.test']);
  assert.deepEqual(await new TeamService(root).members('app'), merged);
  await commit('Old name', 'old@example.test', '2026-05-01T12:00:00Z');
  const updated = await service.members('app');
  assert.equal(updated.find((m) => m.email === alice.email)?.commits, 4);
  assert.equal(updated.find((m) => m.email === alice.email)?.name, 'Alice');
  await bulk({ kind: 'edit', emails: ['alice@example.test'], team: '', tags: [] });
  const cleared = (await service.members('app')).find((m) => m.email === alice.email)!;
  assert.equal(cleared.team, undefined);
  assert.deepEqual(cleared.tags, []);
  const final = await bulk({
    kind: 'merge',
    emails: ['alice@example.test', 'bob@example.test'],
    primary: 'bob@example.test',
  });
  assert.equal(final.length, 1);
  assert.equal(final[0]?.commits, 5);
  assert.deepEqual(final[0]?.aliases, ['alice@example.test', 'old@example.test']);
  await assert.rejects(
    bulk({ kind: 'merge', emails: ['bob@example.test', 'bob@example.test'], primary: 'bob@example.test' }),
    /at least two/,
  );
  await service.assign({ project: 'app', email: 'old@example.test', team: 'Resolved alias', tags: [] });
  assert.equal((await service.members('app'))[0]?.team, 'Resolved alias');
});

test('project member records persist and survive contributor assignment edits', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-team-records-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await storageFor(root).projects.add('app', root);
  await storageFor(root).projects.add('other', root);
  const service = new TeamService(root);
  const member = await service.saveRecord('app', { name: 'Ada', jira_id: 'jira-1', github_login: 'ada' });
  await service.assign({ project: 'app', email: 'ada@example.test', team: 'Platform', tags: [] });
  const updated = await service.saveRecord('app', { ...member, name: 'Ada L' });
  assert.deepEqual(await new TeamService(root).records('app'), [updated]);
  assert.deepEqual(await service.records('other'), []);
  await assert.rejects(
    service.saveRecord('app', { name: 'Other', jira_id: 'jira-2', github_login: 'ADA' }),
    /already belongs/,
  );
  await assert.rejects(service.saveRecord('app', { name: '', jira_id: 'j', github_login: 'g' }));
});
