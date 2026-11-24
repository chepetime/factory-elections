// A change may not pass verification by weakening its tests: deleting test files, skipping or
// focusing tests, or removing more assertions than it adds. Passing tests prove little when the
// change made them easier to pass, so this check reads the diff, not the test output.

/** Test files and test directories, by path. */
export function isTestPath(file: string): boolean {
  return (
    /(^|\/)(__tests__|tests?|specs?)(\/|$)/i.test(file) || /(?:^|[._-])(?:test|spec)\.[^/]+$/i.test(file)
  );
}

/** Markers that skip, focus or postpone a test, in common JavaScript, Python, Go and Java tools. */
const SKIP =
  /\b(?:it|test|describe|suite|context)\.(?:skip|only|todo)\s*\(|\bx(?:it|test|describe)\s*\(|\bf(?:it|describe)\s*\(|@pytest\.mark\.(?:skip|xfail)\b|\bpytest\.skip\s*\(|\bt\.Skip(?:Now|f)?\s*\(|@(?:Disabled|Ignore)\b|\{\s*skip\s*:\s*true\b|\{\s*only\s*:\s*true\b/;

/** A line that asserts something. */
const ASSERTION = /\bassert\w*\b|\bexpect\s*\(|\.should\b|\bt\.(?:Error|Fatal)f?\s*\(|\brequire\.\w+\s*\(/;

/**
 * Ways the diff weakens tests, as plain sentences; empty when it does not. `diff` is unified
 * diff text (`git diff base`). Only test files count; source changes are judged by the tests.
 */
export function testWeakening(diff: string): string[] {
  const findings: string[] = [];
  const counts = new Map<string, { removed: number; added: number }>();
  let file: string | undefined;
  let from: string | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = undefined;
      from = undefined;
      continue;
    }
    if (line.startsWith('--- ')) {
      from = line === '--- /dev/null' ? undefined : line.slice(4).replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (line === '+++ /dev/null') {
        if (from && isTestPath(from)) findings.push(`deletes the test file ${from}`);
        file = undefined;
      } else file = line.slice(4).replace(/^b\//, '');
      continue;
    }
    if (!file || !isTestPath(file)) continue;
    if (line.startsWith('+') && SKIP.test(line))
      findings.push(`skips or focuses a test in ${file}: ${line.slice(1).trim().slice(0, 120)}`);
    const count = counts.get(file) ?? { removed: 0, added: 0 };
    if (line.startsWith('-') && ASSERTION.test(line)) count.removed++;
    else if (line.startsWith('+') && ASSERTION.test(line)) count.added++;
    counts.set(file, count);
  }
  for (const [path, { removed, added }] of counts)
    if (removed > added) findings.push(`removes ${removed - added} assertion line(s) in ${path}`);
  return findings;
}
