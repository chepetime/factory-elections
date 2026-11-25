import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { approveProfile, ensureProfileDraft, profileStatus } from '../src/profile-draft.ts';

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

test('profile status reads missing, draft, approved and invalid', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-draft-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  await writeFile(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const root = join(base, 'data');
  const path = join(root, 'app', 'profile.yaml');

  assert.deepEqual(await profileStatus(root, 'app'), { state: 'missing', path });
  await ensureProfileDraft(root, 'app', repo);
  assert.deepEqual(await profileStatus(root, 'app'), {
    state: 'draft',
    path,
    summary: {
      base_branch: 'main',
      test: 'npm install --no-package-lock && npm run test',
      full_check: 'npm run test',
      forbidden_paths: ['.env', '.github/workflows/'],
    },
  });
  const draft = await readFile(path, 'utf8');
  await writeFile(path, draft.replace('approved_at: ""', 'approved_at: "2026-11-25"'));
  assert.deepEqual(await profileStatus(root, 'app'), { state: 'approved', path, approved_at: '2026-11-25' });
  await writeFile(
    path,
    draft.replace('approved_at: ""', 'approved_at: "2026-11-25"').replace('project: app', 'project: other'),
  );
  const invalid = await profileStatus(root, 'app');
  assert.equal(invalid.state, 'invalid');
  assert.match((invalid as { error: string }).error, /does not match/);
});

test('approving a draft sets today, keeps the comments, and refuses a broken draft', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-draft-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  await writeFile(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const root = join(base, 'data');
  const path = join(root, 'app', 'profile.yaml');

  await assert.rejects(approveProfile(root, 'app', '2026-11-25'), /no profile to approve/);
  await ensureProfileDraft(root, 'app', repo);
  const draft = await readFile(path, 'utf8');

  await writeFile(path, draft.replace(/  full_check: .*\n/, ''));
  assert.equal((await profileStatus(root, 'app')).state, 'invalid', 'a draft missing a command is invalid');
  await assert.rejects(approveProfile(root, 'app', '2026-11-25'), /Fix the profile first: .*full_check/);

  await writeFile(path, draft);
  assert.deepEqual(await approveProfile(root, 'app', '2026-11-25'), {
    state: 'approved',
    path,
    approved_at: '2026-11-25',
  });
  const approved = await readFile(path, 'utf8');
  assert.match(approved, /^# Repository profile for app/);
  assert.match(approved, /\napproved_at: ["']?2026-11-25["']?\n/);
  assert.deepEqual(await approveProfile(root, 'app', '2026-12-01'), {
    state: 'approved',
    path,
    approved_at: '2026-11-25',
  });
});
