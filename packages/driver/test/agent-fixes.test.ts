import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificationSteer } from '../src/agent-fixes.ts';

test('each agent-fixable verification failure gets its own instruction, with the output', () => {
  const size = verificationSteer(
    '[change has 523 non-test lines; limit is 400. Largest non-test files: a.ts (213). Split the task into smaller deployable changes.]',
  )!;
  assert.match(size, /523 non-test lines/);
  assert.match(size, /smallest deployable part/);
  assert.match(size, /new commit/);
  assert.match(size, /follow-up/);

  assert.match(
    verificationSteer('[the change weakens tests: removed 2 assertions. Keep the tests]')!,
    /Fix the code, not the tests/,
  );
  assert.match(
    verificationSteer(
      '[verification left uncommitted changes: a.ts. Commit them or add them to .gitignore.]',
    )!,
    /background/,
  );
  assert.match(verificationSteer('✖ one test\n[test exited with status 1]')!, /Fix what fails/);
  for (const steer of [size, verificationSteer('[test exited with status 1]')!]) {
    assert.match(steer, /Do not merge, rebase, pull or reset/);
    assert.match(steer, /check_change/);
  }
});

test('an environment fault gets no fix turn: the agent cannot fix the machine', () => {
  assert.equal(
    verificationSteer('Error: listen EADDRINUSE: address already in use\n[test exited with status 1]', [
      'EADDRINUSE',
    ]),
    undefined,
  );
});
