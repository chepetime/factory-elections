import { describe, expect, it } from 'vitest';
import { diffFiles } from '@/lib/diff-files';

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1..2 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  ' keep',
  '-old',
  '+new',
  'diff --git a/new.md b/new.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.md',
  '@@ -0,0 +1 @@',
  '+# New',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-a',
  '-b',
  'diff --git a/old/name.ts b/new/name.ts',
  'similarity index 90%',
  'rename from old/name.ts',
  'rename to new/name.ts',
  'diff --git a/logo.png b/logo.png',
  'Binary files a/logo.png and b/logo.png differ',
  '',
].join('\n');

describe('diffFiles', () => {
  it('splits a diff per file with its status and counts, ignoring the ---/+++ header lines', () => {
    expect(diffFiles(diff).map(({ text: _t, ...f }) => f)).toEqual([
      { path: 'src/a.ts', status: 'modified', added: 1, removed: 1 },
      { path: 'new.md', status: 'added', added: 1, removed: 0 },
      { path: 'gone.txt', status: 'deleted', added: 0, removed: 2 },
      { path: 'new/name.ts', from: 'old/name.ts', status: 'renamed', added: 0, removed: 0 },
      { path: 'logo.png', status: 'binary', added: 0, removed: 0 },
    ]);
  });
  it('keeps each file its own part of the diff', () => {
    const [first] = diffFiles(diff);
    expect(first!.text.startsWith('diff --git a/src/a.ts')).toBe(true);
    expect(first!.text).not.toContain('new.md');
  });
  it('returns nothing for an empty diff', () => {
    expect(diffFiles('')).toEqual([]);
  });
});
