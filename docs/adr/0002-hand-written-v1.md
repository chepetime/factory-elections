# Hand-written v1 without Effect

Status: accepted (2026-11-13). Amends ADR 0001 for the first release.

The `.plain` specifications were meant to be rendered into code by turri. turri is not installed on the machine that continued the project and has no public install source, and a clone carries no generated code. To deliver a runnable task-to-pull-request loop, the owner chose to write v1 by hand and keep `factory.plain` and `frontend.plain` in step with the code as its specification.

## Decisions

- The code is TypeScript that Node 26 runs directly by stripping types, so there is no build step and `bin/factory` works from a fresh clone after `pnpm install`. Only erasable syntax is allowed (`erasableSyntaxOnly`); `tsc` type-checks without emitting.
- ADR 0001's package boundaries stand: `packages/core` (pure, enforced by lint), `packages/adapters-{fs,git,github,process,claude}`, `packages/driver` and `apps/cli`.
- Effect is not used in v1. The driver uses async functions, typed error classes and ports passed into its constructor. This keeps the hand-written code small; Effect can be introduced behind the same ports later.
- Model definitions use the current Claude models: Haiku for the classifier, Sonnet for coder and reviewer, Opus as the top automatic coder rung, and Fable only as a rung that requires human approval (not yet offered by the CLI).
- The PR body is assembled from the task record instead of a model `author` step.

## Consequences

If turri becomes available again, regenerated code must be reconciled with this hand-written tree rather than replacing it blindly: `factory.plain` describes both the original commands and the workflow commands added here.
