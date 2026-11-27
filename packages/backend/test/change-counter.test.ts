import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChangeCounter } from '../src/change-counter.ts';

test('the counter rises per project with each reported write, under one boot id', () => {
  let report: (project: string) => void = () => {};
  const counter = new ChangeCounter({ onChange: (listener) => ((report = listener), () => {}) });
  const before = counter.versions();
  assert.deepEqual(before.projects, {});
  report('a');
  report('a');
  report('b');
  const after = counter.versions();
  assert.deepEqual(after.projects, { a: 2, b: 1 });
  assert.equal(after.boot, before.boot);
  assert.notEqual(new ChangeCounter({ onChange: () => () => {} }).versions().boot, before.boot);
});
