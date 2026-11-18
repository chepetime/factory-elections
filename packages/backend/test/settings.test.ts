import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storageFor } from '@factory/adapters-data';
import { ProjectSettingsService } from '../src/settings.ts';

test('settings default, save without empty fields, and detection proposes without saving', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-settings-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'data');
  const storage = storageFor(root);
  await storage.projects.add('app', base);
  let answer: unknown = {
    display_name: 'App',
    icon: '🗳️',
    task_manager: { kind: 'jira', cli: 'acli', read_ticket: 'acli jira workitem view {key}' },
    summary: 'Jira via acli, documented in AGENTS.md.',
    evidence: ['AGENTS.md'],
  };
  const seen: string[] = [];
  const settings = new ProjectSettingsService(root, storage, storage.projects, async (repo) => {
    seen.push(repo);
    return answer;
  });

  assert.deepEqual(await settings.get('app'), {
    task_manager: { kind: 'none' },
    tending: { enabled: false, answer_threads: false },
  });
  const proposal = await settings.detect({ project: 'app' });
  assert.deepEqual(seen, [base]);
  assert.equal(proposal.task_manager.cli, 'acli');
  assert.deepEqual(await settings.get('app'), {
    task_manager: { kind: 'none' },
    tending: { enabled: false, answer_threads: false },
  });

  const saved = await settings.save({
    project: 'app',
    json: JSON.stringify({
      display_name: 'App',
      icon: '',
      task_manager: { ...proposal.task_manager, notes: '' },
    }),
  });
  assert.equal(saved.icon, undefined);
  assert.equal(saved.task_manager.notes, undefined);
  assert.deepEqual((await settings.get('app')).task_manager, proposal.task_manager);

  await assert.rejects(settings.save({ project: 'missing', json: '{}' }), /not found/);
  await assert.rejects(
    settings.save({ project: 'app', json: JSON.stringify({ icon: 'way too long icon' }) }),
  );
  answer = { nonsense: true };
  await assert.rejects(settings.detect({ project: 'app' }), /unexpected answer/);
});
