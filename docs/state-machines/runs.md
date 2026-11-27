# Runs

Part of [the state-machine index](../state-machines.md).

Execution follows `queued → running → finalizing → completed | failed`. An unfinished record without an owner is `interrupted`. A terminal record with an owner is still `finalizing`: flushing evidence and releasing the lock are part of completion. Evidence-close failure persists a failed run outcome. Nothing automatically replays.

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| Run observation — core/backend/web | idle, queued, running, finalizing, completed, failed, interrupted, unavailable | Added derived phase without changing persisted states or legacy `running`/`state` fields. Validate persisted run metadata and fail closed. |
| Evidence — Evidence/storage | append/span start → flush → span end → close or failure | Preserve ordered logs, Effect traces and costs. Evidence finalization failure becomes run failure. |
| Evidence visibility — backend | visible → dismissed | Hide output tail independently of outcome/ownership. Retain artifacts and traces. |
| Run attention — core/backend/web | working, needs-you, waiting, done, closed | One rule, [`runAttention`](../../packages/core/src/run-attention.ts), for the sidebar groups, the board card spinner and the home numbers. A live run always works. A `coding` or `reviewing` stage with no live run is interrupted and needs a person. An approved run with no pull request needs a person. `queued` and `classified` wait. The board task view carries `run.owned`. |
| Archive and delete guard — core/backend/web | held → refused; not held → archived | One rule, [`runHeld`](../../packages/core/src/issues.ts): a live run holds its task, whatever the stage. An interrupted run at `coding` or `reviewing` can be archived with no reject first. A live revision of a failed run cannot. A queued turn is still refused. |

Stage predicates `coding | reviewing` and `rejected | pr-opened` now use core `runWorking` and `runFinished` in the backend, agent pickup and the task page.
