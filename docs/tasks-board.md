# Tasks board

**Names.** A *task* is an item on the board. A *run* is one agent attempt at a task (a factory task record, with a UUID). A task can have several runs. The sidebar lists open tasks under Tasks, and their runs under Agents, grouped as Needs you, Working, Idle and Done.

Each project has a board at `/projects/<project>/tasks`. A card is a **task** (an "issue" in code, because "task" already names a factory run). A task has a key such as `CE-12`, a title, a Markdown description, a status, a priority, comments, events, and the factory runs it started.

## Code

| Part | File |
| --- | --- |
| Schema, keys, status mapping, drop rules | `packages/core/src/issues.ts` |
| Storage, numbering, backfill, moves | `packages/backend/src/issues.ts` (`IssueService`) |
| RPCs | `ListIssues`, `GetIssue`, `CreateIssue`, `UpdateIssue`, `MoveIssue`, `CommentIssue` |
| Board | `apps/web/src/components/task-board.tsx` |
| Task page | `apps/web/src/app/projects/[project]/tasks/[id]/page.tsx`, run parts in `components/task-run.tsx` |

## Storage and keys

- One document per project, `<data root>/<project>/issues.json`, through the document store (a file in file mode, a `factory_documents` row in Postgres mode). A semaphore serializes writes, so numbers stay sequential.
- Every read wraps factory runs that no task links to, oldest first. This numbered the existing runs once and picks up runs started from the home composer or feature tickets.
- The key prefix comes from Project settings → General → Task prefix. Empty uses the name initials (`change-elections` → `CE`). Changing the prefix renames every key; numbers stay. Any prefix with the right number still finds the task.
- A run id in a task URL redirects to the task that owns the run.

## Status

While a task has a run, its column follows the run's stage, unless a person set a status after the run last changed.

| Run stage | Column |
| --- | --- |
| queued, classified | Todo |
| coding | In progress |
| reviewing, awaiting-approval | In review |
| approved, pr-opened | Done |
| blocked, failed, verification-failed | Blocked |
| rejected | Cancelled |

## Drops

| Drop on | Does |
| --- | --- |
| In progress | No run, or the last run ended: creates a run from the title and description, then starts it. A runnable stage: runs it again. Otherwise refused. |
| Cancelled | An open run: rejects it. Otherwise sets the status. |
| Backlog, Todo, Done | Sets the status, unless a run is still open (refused). |
| In review, Blocked | Refused: only the factory moves tasks there. |

The board asks before any drop that starts, reruns or cancels a run. No drop can skip the approval gate. Every card has a "Move to" menu for keyboard and touch use.

## Archive and delete

- **Archive** (card menu or the task's status menu) takes a task off the board and the sidebar. Its runs stay. A task whose run is coding or reviewing cannot be archived. The sidebar's Archived link, above Project settings, lists archived tasks with Restore and Delete.
- **Delete** works only on archived tasks. It removes the task and each run's worktree, branch and records, under the run's lock, so a working run refuses. Traces and cost history in telemetry stay. The board keeps the deleted run ids, so a run whose removal failed never comes back as a new task, and task numbers are never reused.
- Composer "Add to board" creates a task in Todo with no run; "Run now" creates the task and starts its first run.

A task can have an agent. Moving it to In progress then starts that agent's session instead of the pipeline. See [Workspace agents](workspace-agents.md).
