import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { files, read, root } from './helpers.ts';

// Agents follow the links in AGENTS.md and docs/harnes first. A renamed file leaves a dead
// link, and a docs-only change skips every other test, so this rule runs on every plan.
const documents = ['AGENTS.md', ...files('docs/harnes/*.md')];

function relativeLinks(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const targets: string[] = [];
  for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]!;
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
    const path = target.split('#')[0]!.split('?')[0]!;
    if (path) targets.push(decodeURIComponent(path));
  }
  return targets;
}

test('the documents that agents read first are found', () => {
  assert.ok(documents.includes('AGENTS.md'));
  assert.ok(
    documents.length > 1,
    'docs/harnes/*.md matched no files; fix the glob in tests/repo/doc-links.test.ts',
  );
});

for (const document of documents) {
  test(`relative links in ${document} name files that exist`, () => {
    const dead = relativeLinks(read(document)).filter(
      (target) => !existsSync(resolve(root, dirname(document), target)),
    );
    assert.deepEqual(
      dead,
      [],
      `Rule: every relative link in ${document} names a file that exists. Agents follow these links first. ` +
        `Fix: update the link in ${document} to the file's new path, or restore the file. Dead links: ${dead.join(', ')}`,
    );
  });
}
