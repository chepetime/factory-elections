import assert from 'node:assert/strict';
import test from 'node:test';
import { compare, countLines, nextBaseline } from './file-size-ratchet-core.mjs';
import { changedPaths, formatBaseline, isProduction, measure, updateBaseline } from './file-size-ratchet.mjs';

test('a new file over 1000 lines fails, one at exactly 1000 passes', () => {
  assert.deepEqual(compare({ 'a.ts': 1001 }, {}).violations, [
    { path: 'a.ts', kind: 'new', lines: 1001, allowed: 1000 },
  ]);
  assert.deepEqual(compare({ 'a.ts': 1000 }, {}), { violations: [], improved: [] });
});

test('a baseline file that grows fails', () => {
  assert.deepEqual(compare({ 'a.ts': 1201 }, { 'a.ts': 1200 }).violations, [
    { path: 'a.ts', kind: 'grew', lines: 1201, allowed: 1200 },
  ]);
});

test('a baseline file that shrinks is reported improved, not failed', () => {
  const result = compare({ 'a.ts': 1100 }, { 'a.ts': 1200 });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.improved, [{ path: 'a.ts', lines: 1100, allowed: 1200 }]);
});

test('a deleted baseline file passes', () => {
  assert.deepEqual(compare({}, { 'gone.ts': 1200 }), { violations: [], improved: [] });
});

test('countLines counts newline characters like wc -l', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\nb'), 1);
});

test('measure skips unreadable files and non-production paths', () => {
  const files = {
    'apps/x/src/a.ts': 'a\n',
    'apps/x/test/a.ts': 'a\n',
    'apps/x/src/a.test.ts': 'a\n',
    'apps/x/src/a.stories.tsx': 'a\n',
    'apps/x/src/a.d.ts': 'a\n',
    'apps/docs/src/a.ts': 'a\n',
    'packages/affect-ui/upstream/a.ts': 'a\n',
    'apps/x/e2e/a.ts': 'a\n',
    'apps/x/README.md': 'a\n',
  };
  const sizes = measure([...Object.keys(files), 'apps/x/src/deleted.ts'], (p) => files[p] ?? null);
  assert.deepEqual(sizes, { 'apps/x/src/a.ts': 1 });
  assert.equal(isProduction('scripts/restart.mjs'), true);
});

test('--update never raises an entry and drops files at or under the cap', () => {
  const baseline = { 'a.ts': 1200, 'b.ts': 1100, 'c.ts': 1050, 'd.ts': 1300 };
  const sizes = { 'a.ts': 1150, 'b.ts': 1100, 'c.ts': 990, 'd.ts': 1400 };
  assert.deepEqual(nextBaseline(sizes, baseline, ['a.ts', 'c.ts', 'd.ts']), {
    'a.ts': 1150,
    'b.ts': 1100,
    'd.ts': 1300,
  });
});

test('on a branch --update changes only the entries of changed files', () => {
  const git = (...args) => {
    if (args.join(' ') === 'diff --name-only --no-renames main...HEAD') return 'a.ts\n';
    if (args.join(' ') === 'diff --name-only HEAD') return 'c.ts\na.ts\n';
    throw new Error(args.join(' '));
  };
  const baseline = { 'a.ts': 1200, 'b.ts': 1200, 'c.ts': 1200 };
  const sizes = { 'a.ts': 1100, 'b.ts': 1100, 'c.ts': 1000 };
  const changed = changedPaths('feature', baseline, git);
  assert.deepEqual(changed.sort(), ['a.ts', 'c.ts']);
  assert.deepEqual(updateBaseline(sizes, baseline, changed), { 'a.ts': 1100, 'b.ts': 1200 });
});

test('on main --update considers every baseline entry', () => {
  const baseline = { 'a.ts': 1200, 'b.ts': 1200 };
  assert.deepEqual(
    changedPaths('main', baseline, () => assert.fail('no git on main')),
    ['a.ts', 'b.ts'],
  );
});

test('the baseline file is sorted, one entry per line, blank line between entries', () => {
  assert.equal(formatBaseline({ 'b.ts': 2, 'a.ts': 1 }), '{\n  "a.ts": 1,\n\n  "b.ts": 2\n}\n');
  assert.equal(formatBaseline({}), '{}\n');
});
