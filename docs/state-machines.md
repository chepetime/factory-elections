# Application state machines

Add or change a state in its machine's file; add a new file for a new machine.

This audit covers application-owned code in `apps/`, `packages/` and `scripts/`, including component demos. Licensed upstream components, framework internals, generated code, agent skill copies and captured request logs are outside its scope. Rows group related states rather than count individual booleans.

The decision: centralize task command policy and execution observation in [the pure core](../packages/core/src/task-controls.ts), use a reducer for concurrent member edits, and keep simple interactions local. No new state-machine runtime or database migration is needed. Effect continues to own execution, concurrency and traces.

The second pass (2026-11-25) applies the same decision to code added after the first audit: feature command policy is in [the pure core](../packages/core/src/feature-controls.ts), the backend guard and the feature page both read it, and `GetFeature` advertises it. Machines that already had one named type and one derivation stay as they are. [Known gaps](#known-gaps) lists what this pass found and did not change.

## Machines

- [Task stages](state-machines/task-stages.md): Stage diagram, readiness, command policy, revision and stage names.
- [Runs](state-machines/runs.md): Run execution, observation, attention, evidence and the archive guard.
- [Projects](state-machines/projects.md): Project registration, profiles and project selection.
- [Worktrees, model attempts and checks](state-machines/coding.md): Worktree, model ladder, model SDK policy, subprocess and verification.
- [Review, approval and publication](state-machines/approval-and-publication.md): Factory review, PR draft, human decision and publication.
- [PR reviews](state-machines/pr-reviews.md): PR review turns and the review list.
- [PR tending](state-machines/pr-tending.md): The PR tending loop.
- [Features](state-machines/features.md): Feature stages, cancel, spec and board edits, and the feature page.
- [Feature tickets](state-machines/feature-tickets.md): Feature ticket states, retry and merge.
- [Tasks board](state-machines/tasks-board.md): The project board and the cross-project board.
- [Agent pickup](state-machines/agent-pickup.md): Routing and assigning todo tasks to agents.
- [Chats](state-machines/chats.md): Agent chat, chat stream, composer and conversation scroll.
- [Memory facts](state-machines/memory.md): Memory fact promotion and drop.
- [Backend, locks and scheduling](state-machines/backend.md): Backend lifecycle, command lock, scheduler and gRPC channel.
- [Storage](state-machines/storage.md): Storage mode, persistence, artifact writer, migration and data services.
- [Task page](state-machines/task-page.md): Task detail, run controls, live run, details panel and issue editor.
- [Other UI state](state-machines/ui.md): Forms, member assignment, team view, resources, sidebar, health and demos.
- [Agent action discovery](state-machines/action-discovery.md): `factory task actions`, `GetTaskControls` and `GetFeature` actions.

## Separate progress, ownership and actions

- **Task stage** is durable workflow progress and can outlive a crashed worker. Existing task JSON and its eleven stages remain compatible.
- **Execution phase** combines a run record with live backend ownership. `unavailable` means observation failed, not idle.
- **Action availability** advertises blockers and required inputs. It is advisory: commands acquire the existing lock and check live gates again.

## Audit passes

- Third pass (2026-11-25): This pass closed the gaps the second pass listed.
- Fourth pass (2026-11-25): This pass closed the last gaps.

## Known gaps

None in the state machines this audit covers. This is not a claim about the whole system: the [roadmap status](vision/roadmap.md#status) and the [architecture assessments](architecture-assessments/2026-11-26-ac0a5377.md) list what is still partial or planned.
