import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TEND_FIXES, nextTendAction, rollupChecks, TendRecord, type PrState } from '../src/tending.ts';

const pr = (x: Partial<PrState> = {}): PrState => ({
  number: 1,
  url: 'u',
  state: 'OPEN',
  head_sha: 'h1',
  base: 'main',
  mergeable: 'MERGEABLE',
  checks: [],
  threads: [],
  ...x,
});
const record = (x: Partial<TendRecord> = {}) => TendRecord.parse({ number: 1, url: 'u', ...x });
const me = { me: 'me', answerThreads: true };

test('tending picks one action: end, conflicts, threads, rerun once, then fix, then stop', () => {
  assert.deepEqual(nextTendAction(pr({ state: 'MERGED' }), record(), me), { kind: 'end', state: 'MERGED' });
  assert.equal(nextTendAction(pr({ mergeable: 'CONFLICTING' }), record(), me).kind, 'merge-base');
  const thread = {
    id: 'th',
    resolved: false,
    outdated: false,
    comments: [{ id: 'c1', author: 'rev', body: 'rename this' }],
  };
  assert.equal(nextTendAction(pr({ threads: [thread] }), record(), me).kind, 'answer-threads');
  assert.equal(
    nextTendAction(pr({ threads: [thread] }), record(), { ...me, answerThreads: false }).kind,
    'wait',
  );
  assert.equal(nextTendAction(pr({ threads: [thread] }), record({ answered: ['th:c1'] }), me).kind, 'wait');
  const mine = { ...thread, comments: [...thread.comments, { id: 'c2', author: 'me', body: 'done' }] };
  assert.equal(
    nextTendAction(pr({ threads: [mine] }), record(), me).kind,
    'wait',
    'my reply is last: the reviewer is next',
  );
  const failed = { name: 'test', state: 'fail' as const, run_id: '42' };
  assert.equal(nextTendAction(pr({ checks: [failed] }), record(), me).kind, 'rerun');
  assert.equal(nextTendAction(pr({ checks: [failed] }), record({ reruns: ['h1'] }), me).kind, 'fix-ci');
  assert.equal(
    nextTendAction(pr({ checks: [failed, { name: 'b', state: 'pending' }] }), record(), me).kind,
    'wait',
  );
  assert.deepEqual(
    nextTendAction(
      pr({ checks: [failed] }),
      record({ reruns: ['h1'], fixes_since_green: MAX_TEND_FIXES }),
      me,
    ),
    {
      kind: 'stop',
      reason: '3 fixes did not make the PR green',
    },
  );
});

test('status rollups become pass, fail, pending and skipped checks with their run ids', () => {
  assert.deepEqual(
    rollupChecks([
      {
        name: 'unit',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        detailsUrl: 'https://github.com/o/r/actions/runs/123/job/4',
      },
      { name: 'lint', status: 'IN_PROGRESS', conclusion: '' },
      { context: 'ci/legacy', state: 'SUCCESS' },
      { name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
    ]).map((c) => [c.name, c.state, c.run_id ?? null]),
    [
      ['unit', 'fail', '123'],
      ['lint', 'pending', null],
      ['ci/legacy', 'pass', null],
      ['docs', 'skipped', null],
    ],
  );
});
