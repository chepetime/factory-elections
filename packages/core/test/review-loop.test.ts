import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewFixNote, reviewNotes, reviewNotesSection, splitFindings } from '../src/index.ts';

const findings = [
  { severity: 'critical', title: 'Data loss on retry', file: 'a.ts', line_range: '10-12', fix: 'Guard it' },
  { severity: 'Must-Fix', title: 'Missing test' },
  { severity: 'should-fix', title: 'Rename the helper', file: 'b.ts' },
];

test('critical and must-fix findings go back to the agent; should-fix stays for people', () => {
  const { important, rest } = splitFindings(findings);
  assert.deepEqual(
    important.map((f) => f.title),
    ['Data loss on retry', 'Missing test'],
  );
  assert.deepEqual(
    rest.map((f) => f.title),
    ['Rename the helper'],
  );
  const note = reviewFixNote(important, 1);
  assert.match(note, /round 1\) found 2 issues/);
  assert.match(note, /1\. \[critical\] Data loss on retry \(`a\.ts:10-12`\)\n {3}Suggested fix: Guard it/);
});

test('the PR section lists what was left, or says nothing was', () => {
  const section = reviewNotesSection({
    round: 2,
    fixes: 1,
    notes: reviewNotes(splitFindings(findings).rest),
  });
  assert.match(section, /^## Automated review\n\n2 senior PR reviews, 1 fix round by the agent\./);
  assert.match(section, /- \*\*should-fix\*\* Rename the helper \(`b\.ts`\)/);
  assert.match(reviewNotesSection({ round: 1, fixes: 0, notes: [] }), /Nothing was left open\./);
});
