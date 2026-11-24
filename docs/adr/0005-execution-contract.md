# ADR 0005: One execution vocabulary across adapters

Status: accepted (2026-11-24) for phase 1 of the [roadmap](../vision/roadmap.md). The design source is [workspace-and-runtime.md §8 and §12](../vision/workspace-and-runtime.md#8-session-and-execution-contracts). The evidence is in [runtime-baseline.md](../runtime-baseline.md).

## Context

A run record has one `state`. A run that the user stopped is stored as `failed`. Nothing records whether a stopped provider left processes behind, and the baseline shows that Codex does. Provider sessions are saved only where a feature needs them (review chats), as bare native IDs. Capabilities are one static table per provider, so they cannot say "this adapter, at this version, cannot stop its descendants".

## Decision

1. **Outcome is separate from state, and cleanup is separate from outcome.** `packages/core/src/execution.ts` defines `ExecutionOutcome` (`completed`, `failed`, `cancelled`, `interrupted`) and `CleanupRecord` (`clean`, `uncertain`, with its reasons). Task runs keep their `state` field, so `executionPhase` and older records do not change, and add `outcome` and `cleanup` when they finish. A stopped run has outcome `cancelled`.
2. **Adapters report cleanup evidence.** A model call that stops early says whether its adapter verified that descendants stopped. The backend combines the calls of a run: one uncertain call makes the run's cleanup `uncertain`. The outcome stays what it was. A slow or uncertain cleanup never turns a completed result into a failure.
3. **Provider sessions are references, not identities.** `ProviderSessionRef` stores provider, native ID, work directory and continuity scope. A run lists the sessions it used. The Factory run ID stays the identity of the attempt.
4. **Capabilities belong to a runner instance.** A `ModelRunner` may declare `capabilities`. `ProviderRouter` uses them, and falls back to `PROVIDER_CAPABILITIES` for runners that declare none. New flags: `interrupt`, `supplementalInput`, `callIds` and `descendantCleanup`. Their values come from the baseline, not from vendor documentation.
5. **Extra input returns a receipt.** `SupplementReceipt` is `accepted`, `queued` or `rejected` with a reason. No adapter supports extra input yet, so the type exists only to fix the contract before phases 2 and 3.

## Deferred

- An ownership generation for fencing, and recovery that reads cleanup records: phase 4.
- Blocking new work while a cleanup is uncertain: phase 4. Phase 1 records and shows it.
- Saving session IDs before the call ends, so that a crash keeps them: phases 3 and 4.
- `inspect()` that reads the installed CLI version at runtime: phase 2, with the app-server adapter. Phase 1 uses the pinned `TESTED_RUNTIMES`.

## Consequences

Older run records have no `outcome`. Readers derive one from `state` with `runOutcome`. Web and RPC readers that ignore the new fields keep working.
