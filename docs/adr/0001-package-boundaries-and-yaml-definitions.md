# Package boundaries and YAML definitions

Status: accepted. The package list and adapter layering are updated by [ADR 0006](0006-package-boundaries-after-the-backend-split.md).

The reference factory's flat modules and fixed driver paths combine policy, orchestration and outside effects. This factory uses pnpm workspace packages, a pure domain core and validated YAML definitions so behavior can be tested independently and loops can change without rewriting the driver. It is a redesign, not a module-for-module port.

## Packages and dependencies

- `packages/core` owns task, stage, step, loop, policy, decision and run-record concepts, transitions and decisions. It has no I/O, SDK, filesystem, clock or process dependencies. It expresses required capabilities as interfaces and produces decisions or commands without executing them.
- `packages/adapters-*` implement those interfaces for the filesystem task store, git and worktrees, GitHub, the Claude Agent SDK, the clock and process spawning. Each adapter hides its integration behind a focused interface; adapters do not import one another.
- `packages/driver` interprets a loop, calls the core and coordinates adapters. It owns effect execution, not domain policy. `packages/dispatcher` schedules driver runs when that phase is built. `apps/cli` and `apps/web` are entry points that compose the packages; the web app is a thin client, not another task engine.
- Dependencies point inward: core imports no other workspace package; adapters and driver depend on core, not each other; dispatcher depends on the driver and core, not concrete adapters; apps assemble the concrete implementations. A composition root supplies implementations to the driver and dispatcher. Enforce these rules with lint, with warnings denied. Create packages only as their behavior is needed.

Backend orchestration and adapters use Effect for effectful workflows, dependency composition and typed errors; the pure domain core stays independent of Effect. This keeps runtime concerns at the boundary while retaining a domain that can be tested without I/O. Zod remains the validator for YAML definitions.

The task file is the authoritative record of task state and decisions. Run records and associated artifacts preserve run evidence; any later telemetry database is a rebuildable cache, not a second authority. No Work Hub or mirror is introduced.

## Definitions and safety

Steps, loops and model ladders are separate YAML definitions validated with zod before a run. A step definition names its prompt, model or ladder, effort, permissions, inputs and outputs. A loop names its ordered steps and gates and may override step settings; validation checks references and that required inputs are available before use. The task records its selected loop. Classification states facts; policy, not the classifier, chooses the loop and starting rung when the human has not selected a loop.

The driver interprets definitions rather than branching on each loop or step name. A new step or loop can be added with a definition and prompt when it uses existing capabilities. Definitions cannot grant new privileged capabilities: branch mutation, pushing and opening PRs use explicitly registered, bounded operations. Every code-producing loop must pass changed-file verification and human review before opening a PR, and flagged decisions block the PR. The validator rejects loops that omit these protections; runtime checks enforce them too. Fable remains a break-glass rung requiring a human's one-task approval, not an editable bypass.

Model selection comes from definitions and a factory-wide family-to-model mapping, never model strings embedded in driver logic. V1 uses Claude only. Configuration is split by its reader rather than recreating the mixed `policy.json`. Run records identify the loop and the versions of its loop definition, step definition and relevant factory-wide policy.

## Consequences

Use Node 26 or later, ESM, strict TypeScript and pnpm workspaces. Tests live with packages: pure core tests use in-memory fakes, real adapters and their fakes share contract suites, and a small end-to-end suite uses a scripted model without real model calls, GitHub or git remotes. Add changed-only test selection early. The first implementation is the CLI code loop for one repo profile; dispatcher, web, research and other later-phase features wait for their phase.

Compared with one configurable driver, the package boundaries and schema validation add initial setup, but make dependencies and unsafe definitions visible. Compared with arbitrary plugins, a fixed set of privileged operations limits extension until a new capability is deliberately implemented and reviewed.
