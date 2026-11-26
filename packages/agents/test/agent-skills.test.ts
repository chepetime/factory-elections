import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AGENT_SKILL_DIRS, agentSkills, availableSkills } from '../src/agent-sessions.ts';

test('skills come from Factory definitions first, then the skills shipped for Claude', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'factory-skills-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const first = join(base, 'definitions');
  const second = join(base, 'claude');
  const skill = async (dir: string, name: string, text: string) => {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(join(dir, name, 'SKILL.md'), text);
  };
  await skill(first, 'review', 'From definitions');
  await skill(second, 'review', 'Shadowed');
  await skill(second, 'design', 'Design rules');
  await mkdir(join(second, 'empty'), { recursive: true });
  assert.deepEqual(await availableSkills([first, second]), ['design', 'review']);
  const text = await agentSkills(['review', 'design', 'missing', '../etc'], [first, second]);
  assert.match(text, /## Skill: review\n\nFrom definitions/);
  assert.match(text, /## Skill: design\n\nDesign rules/);
  assert.doesNotMatch(text, /Shadowed|missing|etc/);
});

test('the real skill folders include the PR review skill', async () => {
  const names = await availableSkills(AGENT_SKILL_DIRS);
  assert.ok(names.includes('senior-pr-review'));
});
