// Validated shapes shared by the CLI, adapters and web app. Mirrors resources/*.schema.json.
import { z } from 'zod';

export const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ProjectName = z.string().regex(NAME_PATTERN, 'must contain only ASCII letters, digits, - and _');
export const TaskId = z.string().regex(UUID_PATTERN, 'must be a UUID');
const NonEmpty = z.string().trim().min(1);
export const Effort = z.enum(['low', 'medium', 'high', 'max']);
export type Effort = z.infer<typeof Effort>;

export const Project = z.object({ name: ProjectName, repo: NonEmpty }).strict();
export type Project = z.infer<typeof Project>;

export const Blocker = z.looseObject({
  kind: z.enum(['research', 'clarification', 'slicing']),
  question: NonEmpty,
});

const VerdictShape = z.looseObject({
  intake_id: NonEmpty,
  kind: z.enum(['code', 'research', 'unsupported']),
  loe: z.enum(['S', 'M', 'L', 'unknown']),
  readiness: z.enum(['ready', 'needs-research', 'needs-clarification', 'needs-slicing']),
  blockers: z.array(Blocker),
});

const BLOCKER_ORDER = ['research', 'clarification', 'slicing'] as const;

/** Readiness must agree with the blockers: none means ready, else the first kind in priority order. */
export function expectedReadiness(blockers: readonly { kind: string }[]): string {
  if (blockers.length === 0) return 'ready';
  const first = BLOCKER_ORDER.find((kind) => blockers.some((b) => b.kind === kind));
  return `needs-${first}`;
}

export const ClassifierVerdict = VerdictShape.superRefine((verdict, ctx) => {
  const expected = expectedReadiness(verdict.blockers);
  if (verdict.readiness !== expected) {
    ctx.addIssue({
      code: 'custom',
      path: ['readiness'],
      message: `readiness "${verdict.readiness}" is inconsistent with blockers; expected "${expected}"`,
    });
  }
});
export type ClassifierVerdict = z.infer<typeof ClassifierVerdict>;

/** Plain JSON Schema the classifier model is asked to produce. */
export const CLASSIFIER_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['intake_id', 'kind', 'loe', 'readiness', 'blockers'],
  properties: {
    intake_id: { type: 'string' },
    kind: { enum: ['code', 'research', 'unsupported'] },
    loe: { enum: ['S', 'M', 'L', 'unknown'] },
    readiness: { enum: ['ready', 'needs-research', 'needs-clarification', 'needs-slicing'] },
    blockers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'question'],
        properties: {
          kind: { enum: ['research', 'clarification', 'slicing'] },
          question: { type: 'string' },
        },
      },
    },
  },
} as const;

export const STAGES = [
  'queued',
  'classified',
  'blocked',
  'coding',
  'verification-failed',
  'reviewing',
  'awaiting-approval',
  'approved',
  'rejected',
  'pr-opened',
  'failed',
] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;

export const Finding = z.looseObject({
  severity: z.enum(['blocking', 'major', 'minor', 'nit']),
  message: NonEmpty,
  file: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const ReviewOutput = z.looseObject({
  verdict: z.enum(['approve', 'request-changes']),
  summary: NonEmpty,
  findings: z.array(Finding),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

export const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'summary', 'findings'],
  properties: {
    verdict: { enum: ['approve', 'request-changes'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'message'],
        properties: {
          severity: { enum: ['blocking', 'major', 'minor', 'nit'] },
          message: { type: 'string' },
          file: { type: 'string' },
        },
      },
    },
  },
} as const;

/** Pull-request title and description drafted by the pr-writer step. */
export const PrDraft = z.looseObject({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1),
});
export type PrDraft = z.infer<typeof PrDraft>;

export const PR_DRAFT_SCHEMA = {
  type: 'object',
  required: ['title', 'body'],
  properties: {
    title: { type: 'string', maxLength: 72 },
    body: { type: 'string' },
  },
} as const;

const Iso = z.string().min(1);

export const StepAttempt = z.looseObject({
  step: NonEmpty,
  rung: NonEmpty,
  model: NonEmpty,
  effort: Effort,
  started_at: Iso,
  finished_at: Iso,
  outcome: z.enum(['completed', 'failed']),
  cost_usd: z.number().nullable(),
  error: z.string().optional(),
});
export type StepAttempt = z.infer<typeof StepAttempt>;

export const TaskEvent = z.looseObject({ at: Iso, kind: NonEmpty, message: z.string() });
export type TaskEvent = z.infer<typeof TaskEvent>;

export const TaskRecord = z.looseObject({
  id: TaskId,
  project: ProjectName,
  repo: NonEmpty,
  prompt: z.string().refine((p) => p.trim().length > 0, 'must not be empty'),
  stage: Stage,
  created_at: Iso.optional(),
  updated_at: Iso.optional(),
  verdict: ClassifierVerdict.optional(),
  worktree: z.looseObject({ path: NonEmpty, branch: NonEmpty, base_branch: NonEmpty }).optional(),
  attempts: z.array(StepAttempt).optional(),
  verification: z
    .looseObject({ passed: z.boolean(), head_sha: NonEmpty, at: Iso, output_tail: z.string() })
    .optional(),
  review: ReviewOutput.extend({ head_sha: NonEmpty, at: Iso }).optional(),
  pr_draft: PrDraft.extend({ head_sha: NonEmpty, at: Iso }).optional(),
  approval: z
    .looseObject({
      decision: z.enum(['approved', 'rejected']),
      head_sha: NonEmpty,
      at: Iso,
      note: z.string().optional(),
    })
    .optional(),
  revision_notes: z.array(z.looseObject({ at: Iso, note: NonEmpty })).optional(),
  pr: z.looseObject({ url: NonEmpty, branch: NonEmpty, head_sha: NonEmpty, at: Iso }).optional(),
  events: z.array(TaskEvent).optional(),
});
export type TaskRecord = z.infer<typeof TaskRecord>;

export const RepoProfile = z.looseObject({
  project: ProjectName,
  approved_at: NonEmpty,
  repo: z.looseObject({ base_branch: z.looseObject({ value: NonEmpty, source: NonEmpty }) }),
  commands: z.looseObject({ test: NonEmpty, full_check: NonEmpty }),
  confirmed: z.looseObject({ forbidden_paths: z.array(z.string()), forbidden_commands: z.array(z.string()) }),
  design_sources: z.array(z.string()),
  qa_targets: z.array(z.string()),
});
export type RepoProfile = z.infer<typeof RepoProfile>;

export const StepDefinition = z.looseObject({
  name: NonEmpty,
  prompt: NonEmpty,
  model: NonEmpty,
  inputs: z.array(NonEmpty),
  outputs: z.array(NonEmpty),
});
export type StepDefinition = z.infer<typeof StepDefinition>;

export const ModelLadder = z
  .looseObject({
    name: NonEmpty,
    rungs: z
      .array(
        z.looseObject({
          name: NonEmpty,
          model: z.string().startsWith('claude-'),
          effort: Effort,
          requires_human_approval: z.boolean().optional(),
        }),
      )
      .min(1),
  })
  .superRefine((ladder, ctx) => {
    const seen = new Set<string>();
    ladder.rungs.forEach((rung, i) => {
      if (seen.has(rung.name))
        ctx.addIssue({
          code: 'custom',
          path: ['rungs', i, 'name'],
          message: `duplicate rung "${rung.name}"`,
        });
      seen.add(rung.name);
    });
  });
export type ModelLadder = z.infer<typeof ModelLadder>;
export type Rung = ModelLadder['rungs'][number];

export const REQUIRED_CODE_ENTRIES = [
  ['step', 'coder'],
  ['gate', 'verify'],
  ['step', 'reviewer'],
  ['gate', 'human-review'],
  ['gate', 'decisions-clear'],
  ['gate', 'open-pr'],
] as const;

export const LoopDefinition = z
  .looseObject({
    name: NonEmpty,
    produces_code: z.boolean(),
    entries: z.array(z.looseObject({ kind: z.enum(['step', 'gate']), name: NonEmpty })).min(1),
  })
  .superRefine((loop, ctx) => {
    if (!loop.produces_code) return;
    let from = 0;
    for (const [kind, name] of REQUIRED_CODE_ENTRIES) {
      const index = loop.entries.findIndex((e, i) => i >= from && e.kind === kind && e.name === name);
      if (index < 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries'],
          message: `a code-producing loop must include ${kind} "${name}" after the preceding required entries`,
        });
        return;
      }
      from = index + 1;
    }
  });
export type LoopDefinition = z.infer<typeof LoopDefinition>;

export const ClassifierRequest = z
  .object({ task: TaskRecord, prompt: NonEmpty, model: z.string().startsWith('claude-'), effort: Effort })
  .strict();
export type ClassifierRequest = z.infer<typeof ClassifierRequest>;

export const ReadinessDecision = z.object({
  action: z.enum(['continue', 'research', 'ask-human', 'slice', 'unsupported']),
});
export type ReadinessDecision = z.infer<typeof ReadinessDecision>;

/** Formats the first zod issue as "path: message". */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}
