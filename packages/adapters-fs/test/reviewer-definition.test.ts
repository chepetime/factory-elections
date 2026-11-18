import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { readReviewerDefinition } from '../src/index.ts';

test('reviewer definitions load their named lenses and reject unsafe paths', async (t) => {
  const root = resolve(import.meta.dirname, '../../..');
  const dir = join(root, 'definitions/reviewers');
  const lenses = join(root, 'definitions/skills/senior-pr-review/lenses');
  const names = (await readdir(dir)).filter((name) => name.endsWith('.yaml'));
  assert.equal(names.length, 8);
  for (const name of names) {
    const { reviewer, lenses: content } = await readReviewerDefinition(join(dir, name), lenses);
    assert.equal(`${reviewer.name}.yaml`, name);
    assert.equal(content.length, reviewer.lenses.length);
    assert.ok(content.every((text) => text.length > 0));
  }
  const temp = await mkdtemp(join(tmpdir(), 'factory-reviewer-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const file = join(temp, 'bad.yaml');
  await writeFile(
    file,
    'name: bad\nlenses: [../secret.md]\ntrigger: always\nrisks: [high]\nmodel: codex\neffort: high\nbudget_usd: 1\ntools: [read]\nhunks: all\n',
  );
  await assert.rejects(readReviewerDefinition(file, lenses));
});
