// Pure parsing of `git log --format=%aN%x1f%aE%x1f%aI` into one row per author email.

export interface Contributor {
  /** Lowercased author email: the member's identity. */
  email: string;
  /** Name from the author's most recent commit. */
  name: string;
  commits: number;
  firstCommit: string;
  lastCommit: string;
}

export function aggregateLog(log: string): Contributor[] {
  const byEmail = new Map<string, Contributor>();
  for (const line of log.split('\n')) {
    const [name, rawEmail, at] = line.split('\x1f');
    if (!name || !rawEmail || !at) continue;
    const email = rawEmail.trim().toLowerCase();
    const seen = byEmail.get(email);
    if (!seen) {
      byEmail.set(email, { email, name: name.trim(), commits: 1, firstCommit: at, lastCommit: at });
      continue;
    }
    seen.commits++;
    // Offsets differ per author, so compare instants rather than strings.
    const t = Date.parse(at);
    if (t > Date.parse(seen.lastCommit)) {
      seen.lastCommit = at;
      seen.name = name.trim();
    }
    if (t < Date.parse(seen.firstCommit)) seen.firstCommit = at;
  }
  return [...byEmail.values()].sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
}
