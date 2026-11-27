// Validated shapes shared by the CLI, adapters and web app. Mirrors resources/*.schema.json.
import { z } from 'zod';
import { ModelRef } from './agents.ts';

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
  name: NonEmpty.max(100).optional(),
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
  required: ['intake_id', 'name', 'kind', 'loe', 'readiness', 'blockers'],
  properties: {
    intake_id: { type: 'string' },
    name: { type: 'string', minLength: 1, maxLength: 100 },
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

/** What a runtime check (Reticle) concluded about the running app. Only `yes` is a pass. */
export const RuntimeVerdict = z.enum(['yes', 'no', 'unknown', 'no-fault', 'none']);
export type RuntimeVerdict = z.infer<typeof RuntimeVerdict>;

/** The last `verified: …` line of a runtime check's output; `none` when it printed none. */
export function runtimeVerdict(output: string): RuntimeVerdict {
  const all = [...output.matchAll(/verified:\s*(yes|no-fault|no|unknown)\b/gi)];
  return (all.at(-1)?.[1]?.toLowerCase() as RuntimeVerdict | undefined) ?? 'none';
}

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
  /** Set when the call ended with no result and the driver ran it once more (ADR 0107). */
  retried: z.literal('no-result').optional(),
});
export type StepAttempt = z.infer<typeof StepAttempt>;

export const TaskEvent = z.looseObject({ at: Iso, kind: NonEmpty, message: z.string() });
export type TaskEvent = z.infer<typeof TaskEvent>;

export const TaskRecord = z.looseObject({
  id: TaskId,
  project: ProjectName,
  repo: NonEmpty,
  name: NonEmpty.max(100).optional(),
  prompt: z.string().refine((p) => p.trim().length > 0, 'must not be empty'),
  stage: Stage,
  created_at: Iso.optional(),
  updated_at: Iso.optional(),
  verdict: ClassifierVerdict.optional(),
  worktree: z
    .looseObject({
      path: NonEmpty,
      branch: NonEmpty,
      base_branch: NonEmpty,
      /** When the profile's setup command last succeeded in this worktree. */
      setup_at: Iso.optional(),
      /** Hash of the setup inputs (lockfiles) at that time; a change runs setup again. */
      setup_key: NonEmpty.optional(),
    })
    .optional(),
  /** A local branch to start from instead of the profile's base: the branch of a blocking ticket. */
  stack_on: NonEmpty.optional(),
  /** Jira issue explicitly supplied when this task was submitted. */
  jira_key: NonEmpty.optional(),
  /** The feature ticket this task implements. */
  ticket: z.looseObject({ feature: NonEmpty, id: NonEmpty }).optional(),
  attempts: z.array(StepAttempt).optional(),
  verification: z
    .looseObject({
      passed: z.boolean(),
      head_sha: NonEmpty,
      at: Iso,
      output_tail: z.string(),
      /** The runtime check's verdict, when the profile has one. */
      runtime: RuntimeVerdict.optional(),
      /** Checks that refused the change as too broad for this machine; CI must run them. */
      not_run_locally: z.array(NonEmpty).optional(),
      /** Whether the test-weakening check ran (`checked`) or a person allowed test changes. */
      test_integrity: z.enum(['checked', 'allowed']).optional(),
      /** Built-in protected paths the change touches, which a person allowed for this task. */
      protected_paths_allowed: z.array(NonEmpty).optional(),
    })
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
  /** Follow-ups added after the PR opened, oldest first (see follow-ups.ts). */
  follow_ups: z
    .array(
      z.looseObject({
        at: Iso,
        kind: z.enum(['custom', 'conflicts', 'review']),
        note: NonEmpty,
        /** The workspace agent that does it. */
        agent: NonEmpty,
        /** `you`, or `factory` when the conflict watcher added it. */
        by: NonEmpty,
        /** The PR head when it was added; the watcher adds one conflict follow-up per head. */
        pr_head: NonEmpty.optional(),
      }),
    )
    .optional(),
  /** A person allowed this task to delete, skip or loosen tests (see test-integrity.ts). */
  allow_test_changes: z.boolean().optional(),
  /** A person allowed this task to change built-in protected paths (see BUILT_IN_PROTECTED_PATHS). */
  allow_protected_paths: z.boolean().optional(),
  pr: z.looseObject({ url: NonEmpty, branch: NonEmpty, head_sha: NonEmpty, at: Iso }).optional(),
  /**
   * A PR publication that started and is not recorded yet: saved before each external write
   * (`push`, then `create`), cleared when `pr` is saved. Its presence after a crash means GitHub
   * may hold a result that this record does not.
   */
  publication: z
    .looseObject({
      op_id: NonEmpty,
      head_sha: NonEmpty,
      branch: NonEmpty,
      base: NonEmpty,
      step: z.enum(['push', 'create']),
      at: Iso,
    })
    .optional(),
  events: z.array(TaskEvent).optional(),
  /** `agent`: one open session by a workspace agent, with no reviewer step. Absent means the pipeline. */
  workflow: z.enum(['pipeline', 'agent']).optional(),
  /** The agent working an `agent` run, and its provider session for resumes. */
  agent: NonEmpty.optional(),
  agent_session: NonEmpty.optional(),
});
export type TaskRecord = z.infer<typeof TaskRecord>;

export const RepoProfile = z.looseObject({
  project: ProjectName,
  approved_at: NonEmpty,
  repo: z.looseObject({ base_branch: z.looseObject({ value: NonEmpty, source: NonEmpty }) }),
  commands: z.looseObject({
    test: NonEmpty,
    full_check: NonEmpty,
    /**
     * Optional check of the running app after full_check, e.g. Reticle (`npx @reticlehq/server`).
     * It must print `verified: yes|no|unknown|no-fault`; only `yes` passes, `no` fails.
     */
    runtime_check: NonEmpty.optional(),
    /** Runs once in each new task worktree before coding, e.g. `pnpm install --frozen-lockfile`. */
    setup: NonEmpty.optional(),
  }),
  confirmed: z.looseObject({ forbidden_paths: z.array(z.string()), forbidden_commands: z.array(z.string()) }),
  /** Repository-relative files or directories whose generated output must not be committed. */
  generated_paths: z.array(NonEmpty).optional(),
  /**
   * Committed files a command generates. When merging the base conflicts on a file matching a
   * rule's `paths` (globs, repository-relative), the factory takes the base's copy and runs the
   * rule's `command` once from the worktree root, outside the sandbox, instead of asking the agent.
   */
  regenerate: z.array(z.looseObject({ paths: z.array(NonEmpty).min(1), command: NonEmpty })).optional(),
  /**
   * Cheap checks run before any model call or setup, e.g. an expired cloud login. A failure stops
   * the run and shows `fix`, the command a person runs to repair it.
   */
  preflight: z.array(z.looseObject({ name: NonEmpty, run: NonEmpty, fix: NonEmpty.optional() })).optional(),
  /**
   * Regular expressions for failed check output that means the machine is at fault, in addition
   * to the known faults. Such a failure stops the coder ladder instead of trying a stronger model.
   */
  environment_errors: z
    .array(
      NonEmpty.refine((source) => {
        try {
          new RegExp(source);
          return true;
        } catch {
          return false;
        }
      }, 'must be a valid regular expression'),
    )
    .optional(),
  /** Repository-relative files whose contents decide when setup runs again; default: lockfiles. */
  setup_inputs: z.array(NonEmpty).optional(),
  /** Additional sandbox network domains and absolute write paths for this repository. */
  sandbox: z
    .object({
      allowed_domains: z.array(NonEmpty).optional(),
      allow_write: z.array(NonEmpty).optional(),
      /** Fixed, non-secret environment variables for the coder, e.g. a repository's agent-runner flag. */
      env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
      /**
       * Host variables the coder may read beyond the agent allowlist (packages/core/src/agent-env.ts),
       * e.g. a tool's home directory. Each one is a deliberate choice: an agent can print what it reads.
       */
      pass_env: z
        .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
        .max(50)
        .optional(),
      /**
       * Short-lived npm registry tokens. Before each coder call the host runs `command` (it prints
       * the token) and the coder gets a private npmrc with `<registry>:_authToken=<token>` through
       * NPM_CONFIG_USERCONFIG. The file is removed after the call; the token is never logged.
       */
      npm_tokens: z
        .array(
          z.object({
            registry: z.string().regex(/^\/\/\S+\/$/, 'must look like //host/path/'),
            command: NonEmpty,
          }),
        )
        .optional(),
    })
    .optional(),
  design_sources: z.array(z.string()),
  qa_targets: z.array(z.string()),
  /** Spending and time limits for this repository. Absent values use DEFAULT_TASK_LIMITS. */
  limits: z
    .looseObject({
      task_budget_usd: z.number().positive().max(1000).optional(),
      check_timeout_minutes: z
        .number()
        .positive()
        .max(24 * 60)
        .optional(),
      /** A setup or check command that prints nothing for this long is stopped as stalled. */
      check_stall_minutes: z
        .number()
        .positive()
        .max(24 * 60)
        .optional(),
    })
    .optional(),
});
export type RepoProfile = z.infer<typeof RepoProfile>;

export const StepLimits = z.looseObject({
  /** Wall-clock limit for one call. */
  timeout_minutes: z
    .number()
    .positive()
    .max(24 * 60)
    .optional(),
  /**
   * The call is stopped after this long with no message from the model. While a tool call is open
   * (a long test run, a delegated child task) the model sends nothing, so the limit is 4 times
   * longer, capped by the wall-clock limit; the stop reason names the open tool. Real activity,
   * not elapsed time, is the rule (ADR 0061): a hung tool still stops.
   */
  stall_minutes: z
    .number()
    .positive()
    .max(24 * 60)
    .optional(),
  /** Most one call may spend. The task budget can lower it. */
  budget_usd: z.number().positive().max(1000).optional(),
});
export type StepLimits = z.infer<typeof StepLimits>;

/** Used when a step definition does not set its own limits. */
export const DEFAULT_STEP_LIMITS = {
  timeout_minutes: 60,
  stall_minutes: 20,
  budget_usd: 5,
} as const satisfies Required<StepLimits>;

/** Used when a repository profile does not set its own limits. */
export const DEFAULT_TASK_LIMITS = {
  task_budget_usd: 15,
  check_timeout_minutes: 30,
  check_stall_minutes: 10,
} as const;

export const StepDefinition = z.looseObject({
  name: NonEmpty,
  prompt: NonEmpty,
  model: NonEmpty,
  inputs: z.array(NonEmpty),
  outputs: z.array(NonEmpty),
  /** Bounds for one model call of this step. Absent values use DEFAULT_STEP_LIMITS. */
  limits: StepLimits.optional(),
});
export type StepDefinition = z.infer<typeof StepDefinition>;

export const ModelLadder = z
  .looseObject({
    name: NonEmpty,
    rungs: z
      .array(
        z.looseObject({
          name: NonEmpty,
          model: ModelRef,
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
  .object({ task: TaskRecord, prompt: NonEmpty, model: ModelRef, effort: Effort })
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
