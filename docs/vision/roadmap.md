# Roadmap

Part of the [product vision](../../VISION.md). The phases come from [workspace-and-runtime.md §14](workspace-and-runtime.md#14-migration-plan). This page maps them to the code. [TODO.md](../../TODO.md) has the tasks.

## What the phases keep

These parts work today. The phases move them behind one contract and do not remove them:

- Claude SDK guards (`canUseTool`), the OS sandbox, budgets, timers and cancellation (`packages/adapters-claude/src/index.ts`).
- Slots, git locks, recovery and provider rules in the backend (`packages/backend/src`).
- The span ledger, the inbox, PR tending, metrics and call grading.
- The software workflow and its gates (`packages/driver/src/workflow.ts`, `definitions/`).

## Phases

### Phase 0: Baseline

Pin the Factory revision and the Claude SDK, Claude CLI and Codex CLI versions. Capture sanitized protocol fixtures from each path: SDK tasks, detached review turns, `codex exec --json`. Write lifecycle checks for the current paths: cancel during output, cancel during a shell tool, resume, stderr noise.

**Exit:** each existing path has documented behavior and reproducible lifecycle checks. *Recorded on 24 Nov 2026 in [runtime-baseline.md](../runtime-baseline.md); two scenarios are still open.*

### Phase 1: Shared contract

Add execution and provider-session identity, tool-call and parent-call IDs on events, separate stdout and stderr, and retry from evidence. Keep the current transports.

Known gaps this phase closes:

| Gap | Where |
| --- | --- |
| Shared tool events have no call IDs | `AgentEvent` in `packages/core/src/agents.ts` |
| Codex stdout and stderr share one callback; any output renews activity | `packages/adapters-codex/src/index.ts` |
| Rate-limit retry uses `!error.costUsd`, so unknown cost counts as zero | `packages/adapters-claude/src/index.ts:159` |
| Capabilities are static per provider, not per adapter and version | `PROVIDER_CAPABILITIES` in `packages/core/src/agents.ts` |
| Outcome and cleanup are one status | Run finalization in `packages/backend/src` |

**Exit:** all adapters emit the same lifecycle vocabulary and keep their native detail.

### Phase 2: Codex prototype

Codex app-server over stdio behind a feature flag: initialize, start or resume a thread, stream, interrupt, explicit failed-resume handling. The batch adapter stays for verified one-shot work. Validate request shapes against the pinned CLI's protocol schema, not against Multica. Steps: [workspace-and-runtime.md §9](workspace-and-runtime.md#9-codex-implementation-plan).

**Exit:** continuity, cancellation and failure scenarios pass against the supported CLI versions.

### Phase 3: Claude consolidation

Move PR review and chat turns from detached launches (`spawnDetached` in `packages/pr-reviews/src/reviews.ts`) into the execution manager on the SDK path. Keep the guards, sandbox and budgets. Save session IDs early. Use SDK streaming input and interruption only after a check on the installed SDK and CLI. Steps: [workspace-and-runtime.md §10](workspace-and-runtime.md#10-claude-implementation-plan).

**Exit:** no review-specific detached-process lifecycle remains for migrated work.

### Phase 4: Durable operations

A configuration manifest per execution, restart reconciliation with an ownership generation, one scheduler and shared limits across tasks, chats, reviews and children, and usage checkpoints that know cumulative from incremental counters.

**Exit:** restart and concurrent-work tests keep ownership and cause no duplicate side effects.

### Phase 5: Product generalization

Optional repository resources, project kinds (person, product, initiative), task and conversation links, knowledge items with provenance, non-code artifacts, and the Inbox, Tasks, Projects and Conversations navigation. The model is in [entities.md](entities.md). Answer its open questions first.

**Exit:** the three core journeys work without repository assumptions: prepare a 1:1, implement a ticket together, delegate a feature.

## Later

Add each item only after phases 0–4 are reliable and a measured need exists:

- Warm process pools, remote runtimes, squads, scheduled automations, advanced autonomy.
- The open steps of the earlier build order, with their designs unchanged:
  - Team import (Jira and GitHub) and team baseline metrics.
  - Per-task workflows, inline review and counsel, browser QA, gateways, Pi.
  - The tool broker and tool grants ([tools-and-reviews.md](tools-and-reviews.md)). Phase 4 permissions must fit it.
  - The model router, escalation and cost savings ([models-and-costs.md](models-and-costs.md)).
  - Retro, evals, replay, quotes, earned autonomy, outcomes and upstream proposals.

The trace stays the control input for these steps. Routing, escalation, retro, replay and earned autonomy read the event journal that phases 1 and 4 make reliable.

## Acceptance tests

The scenarios are in [workspace-and-runtime.md §15](workspace-and-runtime.md#15-acceptance-tests). Each phase adds the scenarios for its exit criterion: unit tests for protocol parsing and state transitions, process fixtures for interruption and streams, and a small opt-in real-provider suite that records CLI versions and cost.
