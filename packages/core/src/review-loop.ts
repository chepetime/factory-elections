// The review loop: an agent's draft PR gets a senior-pr-review; the findings that matter go back to
// the agent as a follow-up whose fix is pushed once the checks pass; then the PR is reviewed again.
// When nothing important is left, or after the last fix round, the PR is marked ready for people.
import { z } from 'zod';

/** Fix rounds before the PR is marked ready, whatever the last review said. */
export const REVIEW_LOOP_MAX_FIXES = 2;

/** senior-pr-review severities that go back to the agent; `should-fix` is left for the people. */
export const REVIEW_SEND_BACK = ['critical', 'must-fix'] as const;

export const ReviewLoopState = z.object({
  pr: z.number().int().positive(),
  /** `reviewing`: a review runs. `fixing`: the agent fixes its findings. `ready`: marked ready. */
  state: z.enum(['reviewing', 'fixing', 'ready', 'stopped']),
  /** Reviews started so far. */
  round: z.number().int().nonnegative(),
  /** Fix follow-ups sent so far. */
  fixes: z.number().int().nonnegative(),
  /** Findings of the last review that were not sent back, for the PR description. */
  notes: z
    .array(z.object({ severity: z.string(), title: z.string(), where: z.string().optional() }))
    .default([]),
  /** Findings the last fix round was sent; listed when no review checks that fix. */
  sent: z
    .array(z.object({ severity: z.string(), title: z.string(), where: z.string().optional() }))
    .default([]),
  reason: z.string().optional(),
  history: z
    .array(
      z.object({
        at: z.string(),
        round: z.number().int(),
        decision: z.string(),
        sent: z.number().int(),
        left: z.number().int(),
      }),
    )
    .default([]),
  updated_at: z.string(),
});
export type ReviewLoopState = z.infer<typeof ReviewLoopState>;

export interface LoopFinding {
  severity?: string | null;
  title?: string | null;
  comment?: string | null;
  explanation?: string | null;
  fix?: string | null;
  file?: string | null;
  line_range?: string | null;
}

const where = (f: LoopFinding) =>
  f.file?.trim() ? `${f.file.trim()}${f.line_range?.trim() ? `:${f.line_range.trim()}` : ''}` : undefined;

/** The findings that go back to the agent, and the rest. */
export function splitFindings(findings: readonly LoopFinding[]): {
  important: LoopFinding[];
  rest: LoopFinding[];
} {
  const important = findings.filter((f) =>
    (REVIEW_SEND_BACK as readonly string[]).includes((f.severity ?? '').trim().toLowerCase()),
  );
  return { important, rest: findings.filter((f) => !important.includes(f)) };
}

/** The agent's instructions for a review fix. */
export function reviewFixNote(findings: readonly LoopFinding[], round: number): string {
  return [
    `The senior PR review (round ${round}) found ${findings.length} ${findings.length === 1 ? 'issue' : 'issues'} to fix before people review this PR.`,
    'Fix each one in this branch, or explain in your last message why it is not a problem. Run the tests before you finish.',
    '',
    ...findings.map((f, i) =>
      [
        `${i + 1}. [${(f.severity ?? '').trim()}] ${(f.title ?? f.comment ?? 'Finding').trim()}${where(f) ? ` (\`${where(f)}\`)` : ''}`,
        ...(f.explanation?.trim() ? [`   ${f.explanation.trim()}`] : []),
        ...(f.fix?.trim() ? [`   Suggested fix: ${f.fix.trim()}`] : []),
      ].join('\n'),
    ),
  ].join('\n');
}

/** Findings for the PR description: what the review left for the people. */
export function reviewNotes(findings: readonly LoopFinding[]): ReviewLoopState['notes'] {
  return findings.map((f) => ({
    severity: (f.severity ?? 'note').trim(),
    title: (f.title ?? f.comment ?? 'Finding').trim(),
    ...(where(f) ? { where: where(f) } : {}),
  }));
}

/** The section the PR description gets when the loop marks it ready. */
export function reviewNotesSection(
  state: Pick<ReviewLoopState, 'round' | 'fixes' | 'notes'> & { unreviewed?: ReviewLoopState['notes'] },
): string {
  const lines = [
    '## Automated review',
    '',
    `${state.round} senior PR ${state.round === 1 ? 'review' : 'reviews'}, ${state.fixes} fix ${state.fixes === 1 ? 'round' : 'rounds'} by the agent.`,
  ];
  if (state.notes.length)
    lines.push(
      '',
      'Left for you:',
      '',
      ...state.notes.map((n) => `- **${n.severity}** ${n.title}${n.where ? ` (\`${n.where}\`)` : ''}`),
    );
  if (state.unreviewed?.length)
    lines.push(
      '',
      'Fixed in the last round, not reviewed again:',
      '',
      ...state.unreviewed.map((n) => `- **${n.severity}** ${n.title}${n.where ? ` (\`${n.where}\`)` : ''}`),
    );
  if (!state.notes.length && !state.unreviewed?.length) lines.push('', 'Nothing was left open.');
  return lines.join('\n');
}
