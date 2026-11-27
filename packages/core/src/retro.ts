// The daily retro, as a pure function: which repeated waste pattern deserves one finding in the
// inbox. It reads run signals (run-signals.ts) and the findings already filed, makes no model call
// and starts no run. A finding waits for a person; a task starts only when they click "Create task".
//
// A pattern is a group of runs with the same fingerprint: the waste kind plus the normalized tool
// name and input shape. It becomes a finding only when at least FINDING_MIN_RUNS runs from at least
// FINDING_MIN_SOURCES sources show it, so one noisy agent never files. Of the groups that qualify,
// the one that wasted the most money wins; at most one new finding per call.
import { z } from 'zod';
import { normalizeInput, type RunSignals } from './run-signals.ts';

export const FINDING_MIN_RUNS = 3;
export const FINDING_MIN_SOURCES = 2;
/** A dismissed fingerprint stays quiet this long. */
export const FINDING_QUIET_DAYS = 14;
/** Evidence kept on a finding. */
const EVIDENCE_CAP = 20;

export const RetroFinding = z.object({
  id: z.string(),
  fingerprint: z.string(),
  title: z.string(),
  signal: z.string(),
  evidence: z.object({ trace_ids: z.array(z.string()), task_ids: z.array(z.string()) }),
  /** Null when no run of the group reported a cost. */
  wasted_usd: z.number().nullable(),
  occurrences: z.number().int(),
  first_seen: z.string(),
  last_seen: z.string(),
  status: z.enum(['open', 'dismissed', 'tasked']),
  dismissed_at: z.string().optional(),
  task_key: z.string().optional(),
});
export type RetroFinding = z.infer<typeof RetroFinding>;

type Pattern = NonNullable<RunSignals['pattern']>;
/** Drops ids, paths and long numbers (normalizeInput), so the same loop on another file matches. */
export const fingerprint = (p: Pattern): string =>
  [p.kind, p.tool.toLowerCase(), normalizeInput(p.shape)].join('|');

interface Group {
  fingerprint: string;
  pattern: Pattern;
  runs: RunSignals[];
}

const sum = (runs: readonly RunSignals[], pick: (r: RunSignals) => number | null) =>
  runs.reduce((total, r) => total + (pick(r) ?? 0), 0);
/** Known dollars first; groups with no known cost rank by wasted tokens. */
const rank = (a: Group, b: Group) =>
  sum(b.runs, (r) => r.wasted_usd) - sum(a.runs, (r) => r.wasted_usd) ||
  sum(b.runs, (r) => r.wasted_tokens) - sum(a.runs, (r) => r.wasted_tokens);

const titleOf = (g: Group) =>
  `${g.pattern.kind} in ${g.pattern.tool}${g.pattern.shape ? `: ${g.pattern.shape}` : ''} (${g.runs.length} runs)`;

export interface RetroResult {
  /** The stored list after the retro: repeats of open findings updated, the new finding appended. */
  findings: RetroFinding[];
  /** The one new finding, if any. */
  created?: RetroFinding;
}

export function pickFinding(
  signals: readonly RunSignals[],
  findings: readonly RetroFinding[],
  now: Date,
  newId: () => string = () => crypto.randomUUID(),
): RetroResult {
  const groups = new Map<string, Group>();
  for (const run of signals) {
    if (!run.pattern) continue;
    const key = fingerprint(run.pattern);
    const group = groups.get(key) ?? { fingerprint: key, pattern: run.pattern, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  const stamp = now.toISOString();
  const quietMs = FINDING_QUIET_DAYS * 86_400_000;
  const next = findings.map((f) => ({ ...f }));
  const byFingerprint = new Map(next.map((f) => [f.fingerprint, f]));

  // A repeat of a known fingerprint joins the finding: occurrences and last_seen only.
  const fresh: Group[] = [];
  for (const group of groups.values()) {
    const known = byFingerprint.get(group.fingerprint);
    if (!known) {
      fresh.push(group);
      continue;
    }
    if (
      known.status === 'dismissed' &&
      now.getTime() - Date.parse(known.dismissed_at ?? known.last_seen) >= quietMs
    )
      fresh.push(group);
    if (known.status !== 'open') continue;
    const seen = new Set(known.evidence.trace_ids);
    const added = group.runs.filter((r) => !seen.has(r.trace_id));
    if (!added.length) continue;
    known.occurrences += added.length;
    known.last_seen = stamp;
    known.evidence = {
      ...known.evidence,
      trace_ids: [...known.evidence.trace_ids, ...added.map((r) => r.trace_id)].slice(-EVIDENCE_CAP),
    };
  }

  const eligible = fresh
    .filter((g) => g.runs.length >= FINDING_MIN_RUNS)
    .filter((g) => new Set(g.runs.map((r) => r.source ?? r.trace_id)).size >= FINDING_MIN_SOURCES)
    .sort(rank);
  const top = eligible[0];
  if (!top) return { findings: next };
  const known = byFingerprint.get(top.fingerprint);
  const created: RetroFinding = {
    id: newId(),
    fingerprint: top.fingerprint,
    title: titleOf(top),
    signal: top.pattern.kind,
    evidence: {
      trace_ids: top.runs.map((r) => r.trace_id).slice(0, EVIDENCE_CAP),
      task_ids: [...new Set(top.runs.flatMap((r) => (r.task_id ? [r.task_id] : [])))].slice(0, EVIDENCE_CAP),
    },
    wasted_usd: top.runs.some((r) => r.wasted_usd !== null) ? sum(top.runs, (r) => r.wasted_usd) : null,
    occurrences: top.runs.length,
    first_seen: stamp,
    last_seen: stamp,
    status: 'open',
  };
  // A fingerprint dismissed long enough ago starts a new finding that replaces the dismissed one.
  return { findings: [...next.filter((f) => f !== known || f.status !== 'dismissed'), created], created };
}
