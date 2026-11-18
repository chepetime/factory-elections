import assert from 'node:assert/strict';
import test from 'node:test';
import { planChanges } from './ci-plan.mjs';
test('documentation requires no application tests', () => {
  assert.equal(planChanges(['README.md', 'docs/harnes/LEARNINGS.md', 'apps/web/AGENTS.md']).code, false);
});
test('leaf changes exclude unrelated packages', () => {
  assert.deepEqual(planChanges(['apps/web/src/app/page.tsx']).packages, ['apps/web']);
});
test('dependencies include transitive consumers', () => {
  const plan = planChanges(['packages/adapters-process/src/index.ts']);
  for (const path of ['packages/adapters-codex', 'packages/backend', 'apps/cli', 'apps/backend', 'apps/web'])
    assert.ok(plan.packages.includes(path), path);
  assert.ok(!plan.packages.includes('packages/core'));
});
test('shared, unknown, deleted workspace and prompt inputs fail closed', () => {
  for (const file of [
    'pnpm-lock.yaml',
    'package.json',
    'tsconfig.json',
    'scripts/ci-plan.mjs',
    'packages/removed/src/a.ts',
    'definitions/skills/a/SKILL.md',
  ])
    assert.equal(planChanges([file]).full, true, file);
});
test('empty diff skips tests', () => assert.equal(planChanges([]).code, false));

test('relative cross-workspace test imports count as dependencies', () => {
  assert.ok(planChanges(['packages/backend/src/server.ts']).packages.includes('packages/adapters-data'));
});
test('executable documentation inputs fail closed', () => {
  assert.equal(planChanges(['docs/example.ts']).full, true);
});
