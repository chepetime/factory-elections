import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ReviewCandidate } from '../src/review-candidate.ts';

test('review candidate requires evidence and a valid line range', () => {
  const candidate = {
    file: 'src/a.ts',
    start_line: 4,
    end_line: 6,
    quoted_hunk: '+change()',
    evidence: ['Call fails'],
    proposed_severity: 'high',
    confidence: 'high',
    specialist: 'correctness',
  };
  assert.equal(ReviewCandidate.safeParse(candidate).success, true);
  assert.equal(ReviewCandidate.safeParse({ ...candidate, evidence: [] }).success, false);
  assert.equal(ReviewCandidate.safeParse({ ...candidate, end_line: 3 }).success, false);
  assert.equal(ReviewCandidate.safeParse({ ...candidate, specialist: '' }).success, false);
});
