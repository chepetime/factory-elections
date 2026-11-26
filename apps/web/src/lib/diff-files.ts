// A unified diff (git diff) split per file, with added and removed line counts, for the task
// panel's Changes tab. Pure.

export interface DiffFile {
  /** The path after the change; the old path for a deleted file. */
  path: string;
  /** The path before the change, when the file was renamed. */
  from?: string;
  status: 'added' | 'deleted' | 'renamed' | 'modified' | 'binary';
  added: number;
  removed: number;
  /** This file's part of the diff, from its `diff --git` line. */
  text: string;
}

const unquote = (p: string) => p.replace(/^"(.*)"$/, '$1');

export function diffFiles(diff: string): DiffFile[] {
  const text = diff.replace(/\r\n?/g, '\n');
  const starts = [...text.matchAll(/^diff --git /gm)].map((m) => m.index!);
  return starts.map((start, i) => {
    const part = text.slice(start, starts[i + 1] ?? text.length).replace(/\n$/, '');
    const lines = part.split('\n');
    const header = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(lines[0]!) ?? [];
    let from = header[1] ? unquote(header[1]) : '';
    let to = header[2] ? unquote(header[2]) : from;
    let status: DiffFile['status'] = 'modified';
    let added = 0;
    let removed = 0;
    let inHunk = false;
    for (const line of lines.slice(1)) {
      if (line.startsWith('@@')) inHunk = true;
      else if (!inHunk) {
        if (line.startsWith('new file mode')) status = 'added';
        else if (line.startsWith('deleted file mode')) status = 'deleted';
        else if (line.startsWith('rename from ')) {
          status = 'renamed';
          from = line.slice('rename from '.length);
        } else if (line.startsWith('rename to ')) to = line.slice('rename to '.length);
        else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) status = 'binary';
        else if (line.startsWith('+++ b/')) to = unquote(line.slice(6));
      } else if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
    return {
      path: status === 'deleted' ? from : to,
      ...(status === 'renamed' && from !== to ? { from } : {}),
      status,
      added,
      removed,
      text: part,
    };
  });
}
