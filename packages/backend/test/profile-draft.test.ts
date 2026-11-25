import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureProfileDraft } from '../src/profile-draft.ts';

test('a new project gets a profile draft once, and an existing profile is never replaced', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-draft-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({ scripts: { test: 'node --test', lint: 'oxlint' } }),
  );
  const root = join(base, 'data');

  const first = await ensureProfileDraft(root, 'app', repo);
  assert.equal(first.status, 'drafted');
  const path = (first as { path: string }).path;
  assert.equal(path, join(root, 'app', 'profile.yaml'));
  const text = await readFile(path, 'utf8');
  assert.match(text, /project: app/);
  assert.doesNotMatch(text, /approved_at: ['"]?\d/, 'a draft is never approved');

  await writeFile(path, `${text}\n# reviewed\n`);
  assert.deepEqual(await ensureProfileDraft(root, 'app', repo), { status: 'exists', path });
  assert.match(await readFile(path, 'utf8'), /# reviewed/);
});

test('a draft that cannot be written reports the failure instead of throwing', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-draft-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'not-a-folder');
  await writeFile(root, 'a file where the data root should be');
  const result = await ensureProfileDraft(root, 'app', base);
  assert.equal(result.status, 'failed');
});
