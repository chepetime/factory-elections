// Pure core of the file-size ratchet. No file or git access, so tests can call it directly.
export const LIMIT = 1000;

/** Line count the way `wc -l` reports it: the number of newline characters. */
export function countLines(text) {
  let n = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** Files over the cap, as `{ path: lines }`, from `{ path: lines }`. */
export function overLimit(sizes, limit = LIMIT) {
  return Object.fromEntries(Object.entries(sizes).filter(([, lines]) => lines > limit));
}

/**
 * Compares current sizes with the baseline (`{ path: lines }` of files that were over the cap).
 * - `violations`: a file over the cap that is not in the baseline (`new`), or a baseline file that
 *   grew (`grew`).
 * - `improved`: a baseline file that shrank, or dropped to the cap or under.
 * - A baseline file that no longer exists (deleted or renamed) is neither: it passes.
 */
export function compare(sizes, baseline, limit = LIMIT) {
  const violations = [];
  const improved = [];
  for (const [path, lines] of Object.entries(sizes)) {
    const allowed = baseline[path];
    if (allowed === undefined) {
      if (lines > limit) violations.push({ path, kind: 'new', lines, allowed: limit });
    } else if (lines > allowed) violations.push({ path, kind: 'grew', lines, allowed });
    else if (lines < allowed) improved.push({ path, lines, allowed });
  }
  return { violations, improved };
}

/**
 * The baseline after `--update`: only entries for `changed` files move, and only down. Entries of
 * untouched files keep their value so parallel branches rarely conflict. Never raises an entry.
 */
export function nextBaseline(sizes, baseline, changed, limit = LIMIT) {
  const next = { ...baseline };
  for (const path of changed) {
    const lines = sizes[path];
    if (lines === undefined) {
      delete next[path];
    } else if (path in next && lines <= limit) {
      delete next[path];
    } else if (path in next && lines < next[path]) {
      next[path] = lines;
    }
  }
  return next;
}
