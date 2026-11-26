# ADR 0006: Package boundaries after the backend split

Status: accepted (2026-11-26). It updates [ADR 0001](0001-package-boundaries-and-yaml-definitions.md) for the package list and for adapter layering. The rest of ADR 0001 stays in force.

## Context

ADR 0001 named a `packages/dispatcher` that was never built. Queueing, agent limits and stop-before-start lived in `packages/backend/src/service.ts`, beside RPC, traces and the inbox, and every defect in that code needed the whole backend to test. The web app and the CLI depended on the backend package for the RPC client, driver composition, receipts and environment checks. ADR 0001 also says that adapters do not import one another, but three adapters call `adapters-process` and `adapters-data` wraps `adapters-fs`.

## Decision

1. **The backend is split into packages that do not import it.** Each takes what it needs from the backend as a port, and the backend passes its real services in.

   | Package | Owns | May depend on |
   | --- | --- | --- |
   | `backend-client` | `factory.proto`, the `Methods` contract, `backendCall` | core |
   | `dispatcher` | The task run queue and the one `AgentPool`: worker permits, agent limits, stop before start, shutdown | core |
   | `evidence` | Event logs, the span ledger, receipts, outcomes, experiments | core, adapters-data |
   | `compose` | Driver composition and local environment checks, for the CLI and the backend | core, driver, adapters |
   | `pr-reviews` | Review turns, records and worktrees, behind `ReviewDelegation` and `ReviewMemory` | core, dispatcher, evidence, adapters |
   | `agents` | Profiles, routing, pickup, chats, sessions, tools, delegation, memory, behind `AgentBoard` | core, driver, adapters |
   | `backend` | RPC, command ownership, recovery, the board, features, tending, and the composition of the packages above | all of the above |

2. **The web app reaches the backend only through `backend-client`.** It may not import `backend`, `driver` or any adapter.
3. **Adapters have two layers.** `adapters-process` is the base: it spawns processes and depends on nothing. `adapters-git`, `adapters-github` and `adapters-codex` may import it. `adapters-data` is the storage layer over the local files or Postgres and S3, so it may import `adapters-fs`. No other adapter imports another adapter, and no adapter imports the driver or a backend package.
4. **The driver imports only core.** It reaches adapters through the ports that a composition root passes in.
5. **Shared types and errors live in core.** `Conflict`, `IssueView`, `IssueRun`, `IssueList` and `QueueWait` are in core, so a port and the service behind it use one type, and the server maps one `Conflict` class to `FAILED_PRECONDITION`.

`.oxlintrc.json` enforces items 1 to 4 with `no-restricted-imports` overrides per package.

## Consequences

The dispatcher, evidence and port-based packages are tested with fakes, without gRPC, git or a running backend. A new backend capability that a package needs is added to that package's port, not imported. Injecting `run` into every git and GitHub function would remove the process layer, but it would add churn without changing what the adapters can do, so the layer stays. The backend is still the largest package. Inside it, `run-executor.ts` runs one accepted task run, `task-traces.ts` writes and reads the run, PR and gate spans, and `service.ts` composes them with the RPC-facing methods.
