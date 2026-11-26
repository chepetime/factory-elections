import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACTORY_PR_TEMPLATE, missingHeadings, templateFallback, templateHeadings } from '../src/index.ts';

test('template headings skip comments and code, and a body must keep each one', () => {
  const template = '## What\n<!-- ## Not a heading -->\n```md\n## Nor this\n```\n### Why ##\n';
  assert.deepEqual(templateHeadings(template), ['What', 'Why']);
  assert.deepEqual(
    missingHeadings('## what\n\nx\n\n## Why\n', template),
    [],
    'case and spacing do not matter',
  );
  assert.deepEqual(
    missingHeadings('## What\n\nWhy: because', template),
    ['Why'],
    'a word in prose is not a heading',
  );
  assert.deepEqual(templateHeadings(FACTORY_PR_TEMPLATE), ['Summary', 'Evidence', 'Merge Danger']);
});

test('the fallback body keeps every heading, with the task under the first', () => {
  const body = templateFallback(FACTORY_PR_TEMPLATE, 'Fix the copy');
  assert.match(body, /^## Summary\n\nFix the copy\n\n## Evidence\n\n_Not written/);
  assert.deepEqual(missingHeadings(body, FACTORY_PR_TEMPLATE), []);
});
