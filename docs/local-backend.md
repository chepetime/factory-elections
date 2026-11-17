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

Run/revision acceptance is persisted before returning. Up to 32 runs may be accepted (including the active run); one executes at a time. A task's exclusive command lock is held while queued, running and finalizing evidence. Approval/rejection/PR commands also take that lock. Client disconnects do not cancel accepted work. There is no automatic model retry on transport failure.

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

On an abrupt backend exit, unfinished run records are reported as `interrupted` by a new service; they are not automatically replayed. A hard kill can leave both ownership locks and child processes behind. Inspect the recorded PID, its descendants, the worktree and the run evidence before removing stale locks. Never remove a live owner's lock.

After establishing that all old work stopped, remove the stale `backend.lock` to restart. For an interrupted task, stop the backend and inspect/remove its stale `command.lock` before recovery. An interrupted `coding`/`reviewing` stage requires deliberate task-record repair to `failed` (preserve the remaining evidence) before `task revise`; automatic checkpoint recovery is not implemented. A transport deadline does not prove a command did not happen: inspect the task/run before retrying, especially a PR operation.

This first slice deliberately defers automatic crash recovery, cancellation of process trees, streamed SSE progress, log rotation, pagination, distributed execution and idempotent reconciliation of GitHub operations. It keeps the existing approval gate and does not add any automatic push or PR creation.

## Light checks

```sh
node --test packages/backend/test/server.test.ts
pnpm typecheck
pnpm --filter @factory/web test
```

Five smoke tests use real local gRPC, temporary git repositories and scripted models: authentication/validation/health, a complete reviewed workflow with linked cost spans and CLI forwarding, exclusion/failure cleanup, queue drain/restart reporting, and diagnostic/team round-trips with concurrent assignment updates. Web action tests also cover literal prompt/note preservation and approval fields. They make no paid model calls or external GitHub requests.
