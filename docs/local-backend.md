# Local backend

The small backend owns task execution and persistent run evidence. The configured installation now uses [Postgres and S3 services in Docker](docker-storage.md); the file layout below describes file-mode roots and pre-migration data. Next.js calls it over native gRPC from its Node server. The browser continues using the existing Next.js pages and actions; progress refreshes every three seconds. No browser gRPC client or proxy is required.

```sh
pnpm backend       # backend only: gRPC 127.0.0.1:4319, HTTP health 127.0.0.1:4318
pnpm web -- --dev  # backend plus Next.js on localhost:3000
pnpm web           # production build, backend and Next.js
```

`pnpm web` reuses an authenticated, reachable backend or starts one. It only stops the backend it started. Shutdown stops acceptance and drains accepted runs before exit; it can take as long as the active work. `factory serve` starts the same complete backend. Its existing `--port` flag selects the health port; `FACTORY_BACKEND_PORT` selects gRPC. All entry points share shutdown and ownership behavior.

## Execution and Effect

`packages/backend/src/compose.ts` supplies the same driver and adapters to the CLI and service. Domain rules and exact-head approval checks remain in the driver/core. The async driver is not rewritten: Effect 3 provides server execution fibers, the single-worker semaphore and nested tracing spans around task operations, RPCs and model calls. This partially supersedes ADR 0002's deferral of Effect without introducing Effect into the pure core.

Run/revision acceptance is persisted before returning. Up to 32 runs may be accepted. Up to `FACTORY_TASK_WORKERS` (default 3) execute at once, each in its own worktree; the git adapter runs one repository's administrative commands (worktree add/remove, fetch, push) one at a time. Task runs and PR reviews share one agent limit, `FACTORY_MAX_AGENTS` (default 6): a run waits in `queued` while running agents fill it, and a review start is refused. A task's exclusive command lock is held while queued, running and finalizing evidence. Approval/rejection/PR commands also take that lock. Client disconnects do not cancel accepted work.

### Limits

Each model call gets a wall-clock limit, a stall limit (no message from the model) and a budget, from the step definition's `limits` (`timeout_minutes`, `stall_minutes`, `budget_usd`; defaults 60, 20 and $5). The profile's optional `limits.task_budget_usd` (default $15) caps a whole task: the driver stops before a call when the task's recorded spend reaches it, and lowers each call's budget to what is left. `limits.check_timeout_minutes` (default 30) bounds each verification command, and a stopped check kills its whole process group. A call that the provider rate-limited before it spent anything is retried twice (after 30 s and 2 min); no other call is retried. A usage-limit failure leaves the task `failed` with the instruction to run it again after the reset. The coder may start subagents (the `Agent` tool); their tool calls go through the same guard, sandbox and budget.

PR review turns run `claude -p` with `--max-budget-usd` (`FACTORY_REVIEW_BUDGET_USD`, default $25). Kickoff and re-review turns may not run `gh pr review/comment/merge/close/edit/ready`, `gh issue comment/create/edit`, `gh api` or `git push`; a message the user types has no such rule, so the user can ask the agent to post. Starting a review returns at once: the PR shows `preparing` while the backend fetches it and prepares the worktree, and a failure there shows on the PR. The backend stops a turn with no new output for `FACTORY_REVIEW_STALL_MS` (default 30 min) and marks it stopped for that reason.

While `backend.lock` exists, the CLI forwards `task run`, `revise`, `approve`, `reject` and `open-pr` to the server. `run`/`revise` wait and print log updates; Ctrl-C stops the waiting CLI without killing the server-owned run. Read commands remain available against authoritative task snapshots. Individual mutating step commands require the backend to be stopped. With no backend ownership lock, the CLI retains its original standalone behavior.

`factory task actions --project <name> --id <uuid>`, gRPC `GetTaskControls`, and `GET /api/projects/<name>/tasks/<uuid>/state` return validated action availability. This is an advisory snapshot, not a reservation. See [the state-machine inventory](state-machines.md) for phase semantics, guards and agent guidance.

## Logs, spans and costs

Under the shared `FACTORY_ROOT` (default `~/.local/share/factory`):

```text
backend.lock                         service PID; exclusive data-root ownership
backend-token                        random local credential, created with mode 0600
logs/<instance-id>.jsonl              RPC/server trace events, mode 0600
<project>/tasks/<task-id>/
  task.json                          authoritative workflow decisions, attempts and costs
  command.lock                       exclusive task ownership, including time in queue
  latest-run.json                    pointer to the latest run
  runs/<run-id>/
    run.json                         accepted command, lifecycle and error
    run.log                          full plain progress/check output, mode 0600
    events.jsonl                     ordered logs, Effect span IDs and model costs, mode 0600
```

Short approval/rejection/PR operations also write an audit trace under their own run directory; they do not replace the latest long-running progress pointer.

Every model request has a `model.run` child span sharing its task trace ID. Events include `span.start`, `span.end`, `log` and `model.cost`, with run IDs and sequence numbers. Cost events record model, step, outcome and `cost_usd`. Unknown costs stay `null`; they are never treated as free. If the SDK returns a billed failure, the error carries that cost into the trace. A successful response is traced before domain output validation, so invalid model output does not erase its reported charge. Task-record attempt costs remain compatible with the existing CLI and UI.

`GetBackground` reads at most 32 KB from the end of a plain log and returns at most 8,000 characters. Dismiss hides output without deleting evidence. JSONL spans are local evidence, not an installed OpenTelemetry collector/exporter. Prompts and raw model outputs are not copied into trace attributes; human/check output can still contain sensitive repository information.

Log appends are synchronous and ordered to keep buffering bounded for the current synchronous driver callbacks. This small-server trade-off can affect latency under heavy log volume. Retention/rotation, async backpressure-aware sinks and collector export remain follow-ups; logs are preserved on disk until manually removed.

## Communication and configuration

The versioned contract is `packages/backend/factory.proto`. Explicit commands use protobuf fields; canonical task/project snapshots are JSON envelopes validated with the existing Zod schemas, avoiding a second task-record definition. Regenerate the checked-in portable descriptor with `pnpm rpc:generate` after changing the proto.

Next.js and the CLI use one reusable gRPC channel and deadline-bound requests. The web client keeps its channel across development module reloads. The server binds loopback only and requires a bearer credential on every RPC. The local client reads the same data root's token file, or both processes can use `FACTORY_BACKEND_TOKEN` (at least 32 characters).

Optional backend settings: `FACTORY_BACKEND_PORT` (4319) and `FACTORY_HEALTH_PORT` (4318). Clients use `FACTORY_BACKEND_PORT` too; `FACTORY_BACKEND_ADDRESS=127.0.0.1:<port>` explicitly overrides it. The web health panel and settings also honor `FACTORY_HEALTH_PORT`. Next.js and the backend must run on the same local machine.

Task reads, submissions, execution, progress, environment/profile diagnostics, contributor history and team assignment updates all use gRPC. Next.js neither launches workflow/diagnostic processes nor reads or writes repository/team files. The shared contributor parser stays pure in the core; assignment updates are serialized by an Effect semaphore and written atomically. A missing backend is an explicit error; web actions never fall back to competing CLI workers.

## Interruption and recovery

Shutdown stops acceptance and lets running runs finish for `FACTORY_DRAIN_GRACE_MS` (default 5 min), then aborts their model calls and checks; the run is recorded as failed with the reason, and running the task again continues from the last saved step. Runs still queued are not started during shutdown. On the next start the backend settles what the previous one left: a run that was queued is queued again, a run that was running is marked `interrupted` and its `coding`/`reviewing` task is set to `failed` so it can run again. In file mode a task's `command.lock` is removed only when the process that wrote it no longer exists. PR review agents are separate processes and keep running across a backend restart.

After a hard kill (SIGKILL, power loss) the next start still settles the run records as above, but shutdown did not stop the work first. A hard kill can leave both ownership locks and child processes behind. Inspect the recorded PID, its descendants, the worktree and the run evidence before removing stale locks. Never remove a live owner's lock.

After establishing that all old work stopped, remove the stale `backend.lock` to restart. If a task's `command.lock` stays because a live process holds its PID, confirm that process is not a factory worker before removing the lock. A model step that was cut off starts again from its beginning; the work it saved before (verdict, worktree, commits, verification) is kept. A transport deadline does not prove a command did not happen: inspect the task/run before retrying, especially a PR operation.

Opening a PR first looks for an open PR from the task branch and adopts it, so a retry after a lost write does not open a second one. Still deferred: resuming a model step inside its session, cancelling a run from the UI, streamed SSE progress, log rotation, pagination and distributed execution. The approval gate is unchanged: nothing pushes or opens a PR on its own.

## Light checks

```sh
node --test packages/backend/test/server.test.ts
pnpm typecheck
pnpm --filter @factory/web test
```

Five smoke tests use real local gRPC, temporary git repositories and scripted models: authentication/validation/health, a complete reviewed workflow with linked cost spans and CLI forwarding, exclusion/failure cleanup, queue drain/restart reporting, and diagnostic/team round-trips with concurrent assignment updates. Web action tests also cover literal prompt/note preservation and approval fields. They make no paid model calls or external GitHub requests.
