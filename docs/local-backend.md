# Local backend

The small backend owns task execution and persistent run evidence. The configured installation now uses [Postgres and S3 services in Docker](docker-storage.md); the file layout below describes file-mode roots and pre-migration data. Next.js calls it over native gRPC from its Node server. The browser continues using the existing Next.js pages and actions; progress refreshes every three seconds. No browser gRPC client or proxy is required.

```sh
pnpm backend       # backend only: gRPC 127.0.0.1:4319, HTTP health 127.0.0.1:4318
pnpm web -- --dev  # backend plus Next.js on localhost:3000
pnpm web           # production build, backend and Next.js
```

`pnpm web` reuses an authenticated, reachable backend or starts one. It only stops the backend it started. Shutdown stops acceptance and drains accepted runs before exit; it can take as long as the active work. `factory serve` starts the same complete backend. Its existing `--port` flag selects the health port; `FACTORY_BACKEND_PORT` selects gRPC. All entry points share shutdown and ownership behavior.

## Execution and Effect

`packages/compose/src/compose.ts` supplies the same driver and adapters to the CLI and service. Domain rules and exact-head approval checks remain in the driver/core. The async driver is not rewritten: Effect 3 provides server execution fibers, the worker semaphore (in `packages/dispatcher`) and nested tracing spans around task operations, RPCs and model calls. This partially supersedes ADR 0002's deferral of Effect without introducing Effect into the pure core.

Run/revision acceptance is persisted before returning. Up to 32 runs may be accepted. Up to `FACTORY_TASK_WORKERS` (default 3) execute at once, each in its own worktree; the git adapter runs one repository's administrative commands (worktree add/remove, fetch, push) one at a time. Task runs and PR reviews share one agent limit, `FACTORY_MAX_AGENTS` (default 6): a run waits in `queued` while running agents fill it, and a review start is refused. A task's exclusive command lock is held while queued, running and finalizing evidence. Approval/rejection/PR commands also take that lock. Client disconnects do not cancel accepted work.

### Limits

Each model call gets a wall-clock limit, a stall limit (no message from the model) and a budget, from the step definition's `limits` (`timeout_minutes`, `stall_minutes`, `budget_usd`; defaults 60, 20 and $5). The profile's optional `limits.task_budget_usd` (default $15) caps a whole task: the driver stops before a call when the task's recorded spend reaches it, and lowers each call's budget to what is left. `limits.check_timeout_minutes` (default 30) bounds each verification command, and a stopped check kills its whole process group. A call that the provider rate-limited before it spent anything is retried twice (after 30 s and 2 min); no other call is retried. A usage-limit failure leaves the task `failed` with the instruction to run it again after the reset. The coder may start subagents (the `Agent` tool); their tool calls go through the same guard, sandbox and budget.

PR review turns on Claude run in the backend process on the Agent SDK, with the same settings as `claude -p`: only the repository's settings, no user skills, plugins, hooks, slash commands or MCP servers. `FACTORY_REVIEW_TRANSPORT=cli` runs them as detached `claude -p` processes instead, and other providers always run that way. Each turn has a budget (`FACTORY_REVIEW_BUDGET_USD`, default $25). Kickoff and re-review turns may not run `gh pr review/comment/merge/close/edit/ready`, `gh issue comment/create/edit`, `gh api` or `git push`; a message the user types has no such rule, so the user can ask the agent to post. Starting a review returns at once: the PR shows `preparing` while the backend fetches it and prepares the worktree, and a failure there shows on the PR. The backend stops a turn with no new output for `FACTORY_REVIEW_STALL_MS` (default 30 min) and marks it stopped for that reason.

### Providers and child tasks

**Uncertain cleanup.** A run whose cleanup is `uncertain` (a stopped Codex call, or a run cut off by a crash) may have left processes that still change the worktree. Until a person confirms that nothing still runs, `StartRun` refuses run and revise on that task, and the task controls show a `cleanup` blocker with the reasons. Confirm with `factory task confirm-cleanup --project <p> --id <id>` or the button on the task page.

**Agent environment.** An agent process never gets the backend's environment. It gets an allowlist (PATH, HOME, locale, temp, proxy and certificate settings, version-manager variables) plus its own provider's credential (`ANTHROPIC_*` for Claude, `OPENAI_*`/`CODEX_*` for Codex); see `packages/core/src/agent-env.ts`. Storage credentials, cloud keys, `GITHUB_TOKEN` and `SSH_AUTH_SOCK` do not pass. A profile's `sandbox.pass_env` adds names for its coder, and `FACTORY_AGENT_ENV_ALLOW` (comma-separated) adds names for every agent. Each added name is a deliberate choice, because an agent can print what it reads.

**Evidence receipts.** After a run, an approval and a PR open, the backend saves `receipt.json` beside the task. Each claim is proven, not proven or failed, with its evidence, and only evidence for the exact commit counts. The receipt holds the run's configuration manifests and is signed with this install's Ed25519 key (`<data-root>/receipt-key/`). The signature shows that this install wrote it and that nobody changed it; it is not a third-party attestation. `factory receipt verify --project <p> --id <id> [--rerun]` checks it again. Verification also refuses a change that weakens tests (deleted test files, skip or focus markers, fewer assertions), unless a person set `allow_test_changes` on the task.

All model calls go through one port (`ModelRunner`, `packages/core/src/ports.ts`) and one router (`ProviderRouter`, `packages/core/src/agents.ts`). A ladder rung or step names its provider in `model`: a `claude-…` id runs on the Claude Agent SDK, and `codex` or `codex:<model>` runs `codex exec --json` with the machine's Codex sign-in. Review turns write the same JSONL log on both paths, and the chat reads it with the provider's `AgentCli` parser, so it reads any provider.

Each provider states what it enforces (`PROVIDER_CAPABILITIES`). The router refuses a call that needs a missing capability instead of running it with weaker controls:

| | Claude | Codex |
| --- | --- | --- |
| Screens each tool call (step guard) | yes | no: a guarded step, such as the coder, cannot run on Codex |
| Deny rules that hold for wrapped commands | yes | no: its rules match only the first words, so automated review turns stay on Claude |
| OS sandbox | yes | yes: `read-only`, or `workspace-write` (working directory only, no network) |
| Dollar limit and cost | yes | no: it reports tokens; time and stall limits still apply |
| Structured output | yes | yes: the adapter makes each schema strict (closed objects, optional fields nullable) |

Codex runs ignore the user's `config.toml`, like Claude runs ignore user settings. Codex can run the classifier, reviewer and PR-writer steps, and read-only child tasks.

**Child tasks.** The backend runs one MCP server on 127.0.0.1 (`FACTORY_DELEGATION_PORT`, default a free port) with one tool, `delegate(provider, task, access, model?, budget_usd?)`. The coder step and every review turn get a grant: a bearer token tied to the parent's working directory, its access and a budget. A child never starts another provider directly, so it takes an agent slot from `FACTORY_MAX_AGENTS` (it fails at once when none is free, so a parent never waits on itself), counts against the parent's budget, stops on shutdown and appears in the parent's trace. Rules:

- The coder's grant allows `edit` children with the coder guard and a pool as large as the coder call's own budget; child costs are added to the coder attempt. Review grants allow only `read-only` children, with `FACTORY_REVIEW_DELEGATE_BUDGET_USD` (default $10) per turn.
- A Codex child cannot keep the guard, so it may only read when the parent is guarded. A child without a named budget gets $2.
- Children may start children down to `FACTORY_DELEGATION_DEPTH` (default 2). Each child is limited to 30 minutes, and to 10 minutes with no output.
- A grant lives in memory: after a backend restart, a detached review turn that is still running cannot delegate.

### Repository memory, tool pruning, loop guard and context size

These follow [TokenEconomizer](https://github.com/microsoft/TokenEconomizer). The rules are in `packages/core/src/memory.ts`, and the service is in `packages/backend/src/memory.ts`. Files live under `$FACTORY_ROOT/<project>/memory/`.

- **Facts.** Each tool-using model call of a task run, and each finished review turn, is one session. The backend stores a short digest of each session: commands, failures with their command, tools used, and the outcome. After every 3 sessions, a small model (`FACTORY_MEMORY_MODEL`, default `claude-haiku-5-5`, up to $0.20 for each review) reads the recent digests and the current facts. It proposes facts, and each fact names the sessions that show it. Session IDs that the model was not shown are ignored. A fact goes into the system prompts of the coder, reviewer, PR writer and review turns only after 3 sessions confirm it. A session that contradicts a fact drops it. Text that looks like a credential is never stored. Review costs are in `costs.jsonl`. RPCs: `GetMemory`, `ForgetFact` and `RestoreTools`.
- **Tool pruning.** Review turns record which built-in tools they were offered and which they used. A tool that goes unused for 5 review sessions is left out of the next turns (`--tools`). Core tools are always kept: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `ToolSearch`, `Task` and `Agent`. `RestoreTools` brings all tools back, and pruning then waits 5 more sessions.
- **Loop guard.** In SDK runs (the coder, reviewer and PR writer on Claude), a `PostToolUseFailure` hook counts repeated failures. After 3 identical failures, a judge (`FACTORY_LOOP_JUDGE_MODEL`, default Haiku, up to $0.05) decides whether the turn is stuck. If its confidence is at least 0.7, the agent gets one redirect note on its next tool result. If the failure still repeats after that, the run log says so. The guard never stops a turn. The judge's cost is added to the call's cost. Codex and review turns have no loop guard yet. In-process review turns could get the hook; that is open.
- **Context size.** The project setting `context_tokens` sets the limit: one number, or values per provider and model, for example `{ "default": 150000, "codex": 120000, "claude-opus-5-5": 180000 }`. The default is 150k (`FACTORY_CONTEXT_TOKENS`), where quality starts to fall for current models. At 80% of the limit, and again at 100%, SDK runs log a warning and tell the agent to finish or hand off the work. Review details return `context` (tokens, limit, warn, over) for the chat. Codex reports tokens only for each turn, not for each request, so it gets no context warning.

### Runtime check (Reticle)

A profile can set `commands.runtime_check`, for example `npx @reticlehq/server@<version>` (pin a version), or `cd apps/web && npx @reticlehq/server@<version>` in a monorepo. Verification runs it after `full_check`, with the same timeout. It gets a free `PORT` and runs with `DO_NOT_TRACK=1` and `RETICLE_FEEDBACK=0`, so Reticle sends no telemetry. `.reticle/` is excluded through the repository's local `info/exclude`. The last `verified:` line decides the result:

- `yes` passes.
- `no` fails verification, and the fault lines go back to the coder.
- `unknown`, `no-fault` or no verdict line do not fail, but the task's `verification.runtime` records the verdict, and the gate tells the human to check the running app.

Do not run `reticle init` from the factory: it changes the repository's build config, its agent files and its hooks.

### Features: grill, spec, board, implement, QA

A feature is the unit above tasks. Its rules are in `packages/core/src/features.ts`, and the service is in `packages/backend/src/features.ts`. Files are under `$FACTORY_ROOT/<project>/features/<id>/`: `feature.json`, `spec.md`, `critique.md` and `qa.md`. RPCs: `ListFeatures`, `GetFeature`, `CreateFeature` and `FeatureAction` (`{ id, action, … }`).

1. **Grill** (`grill`, repeated with the developer's answer, or `skip-grill`): the agent asks one question at a time, each with its recommendation, and reads the code instead of asking when it can. The session resumes on every turn. Each settled decision is saved. When no question is left, the feature moves to `spec`.
Feature models default to Sonnet for grill, critique, tickets and QA, and Opus for spec. Override individual steps with `FACTORY_GRILL_MODEL`, `FACTORY_SPEC_MODEL`, `FACTORY_CRITIQUE_MODEL`, `FACTORY_TICKETS_MODEL` or `FACTORY_QA_MODEL`. The legacy `FACTORY_FEATURE_MODEL` sets all but critique unless overridden per step.

2. **Spec** (`write-spec`, `save-spec`, `approve-spec`): the agent writes the spec from the idea, the decisions and the transcript. A second model (`FACTORY_CRITIQUE_MODEL`) critiques it as its builder and verifier would. A human edits it if needed and approves it.
3. **Board** (`plan`, `save-board`, `approve-board` with `mirror`): the agent splits the spec into tickets T1…Tn, each with acceptance checks, a size and `blocked_by` links. A board with an unknown blocker, a self-block or a cycle is refused. `mirror: true` creates each ticket with the project's `create_ticket` command. Ticket text reaches that command as environment variables, so the shell never parses it.
4. **Implement** (automatic, every 20 s): each ticket whose blockers are done becomes a task run, in parallel up to the worker limit. A ticket with one blocker stacks on that blocker's branch, and its PR can open only after the blocker's branch is on origin. A ticket with several blockers waits until a human marks their PRs merged (`mark-merged`). A ticket is done when its task reaches the approval gate. When its PR opens, a senior-pr-review starts once. `retry-ticket` runs a failed ticket again.
5. **QA** (automatic when every ticket is done, or `write-qa`; then `complete`): the agent writes a checklist for the human from the spec, the ticket branches, the PRs and the verification and runtime-check results.

Each step's instructions are the bundled contract in `definitions/features/<step>.md`, plus the repository's own skill when it has one: `grill-with-docs`, `spec-critique` or `test-plan` under `.agents/skills/` or `.claude/skills/`, plus the confirmed repository facts. Agent steps take an agent slot, return at once and show `working` and `error` on the feature. Each step is limited to $3 (a grill turn to $1) and 30 minutes, and has the loop guard. Their costs add up in `cost_usd`.

The profile's optional `commands.setup`, for example `pnpm install --frozen-lockfile`, runs once in each new task worktree before coding. A failure stops the task before any model call, and running the task again retries it.

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

## The span ledger (one trace model)

Every unit of agent work writes one span record when it ends, to `<project>/trace/spans-YYYY-MM.jsonl` (mode 0600). With Postgres and S3 configured, each line goes to S3 and its record to `factory_trace_events` with kind `span`, so SQL can count across runs. The JSONL log is the plain log that a metrics store rebuilds from. The schema is `SpanRecord` in `packages/core/src/trace.ts`, and `TraceLog` in `packages/evidence/src/traces.ts` writes and reads it.

| Span type | Written by | Parent |
| --- | --- | --- |
| `run` | each task run (`StartRun`) | none: the root of the task trace |
| `model` | each model call of the run | the run |
| `tool` | each tool call of a model call or review turn | its call |
| `loop-judge` | each loop-guard judgement | its call |
| `child` | each `delegate` child task, on any provider | the call that started it |
| `review` | each finished PR review turn (written by the sweep) | none |
| `feature-step` | each feature step (grill, spec, critique, tickets, QA) | none; `feature_id` joins them |
| `memory-review` | each fact review | none |
| `gate` | the wait at the approval gate, when the human approves, rejects or asks for a revision | none; `task_id` joins it |

Rules:

- **Cost.** A span's `cost_usd` is its own cost, so a roll-up adds every span. `null` means the provider reported no cost (Codex): it is a gap, never $0. Tool and gate spans have no cost. The loop judge's cost moves from its call to the judge span.
- **Day-one fields.** Every span carries `project`, and `task_id`, `feature_id`, the board `ticket` (with its Jira key when the board was mirrored), the `pr` and the `task_class` (`code/S`) when they are known. The run span also has `replay`: the repo, base branch, base commit, prompt and verification commands. Outcome records (merged, reverted) join later on `task_id` and `pr`.
- **Privacy.** Spans hold no prompts, model output or file contents, except the run span's `replay.prompt`. A tool span keeps a short input summary: the command, path, pattern or URL.
- **Timing.** Tool calls of a review turn have no timings in the log, so their spans have no `duration_ms`.
- **Old evidence.** The per-run `events.jsonl` (below) stays as the run's own log. The ledger is the cross-run record.

## Traces, metrics and the inbox (RPCs)

- **`GetTrace`** (`project`, `json: { task_id | trace_id | feature_id }`) returns `{ spans, roots }`: trees of spans in start order. Each node has `total`, which is its own cost plus the cost of everything under it, with `unknown_cost_spans` kept apart.
- **`GetMetrics`** (`project`, or empty for every project; `json: { from?, to? }`, default the last 7 days) returns the Weekly numbers from `metricsSummary` (`packages/core/src/metrics.ts`):
  - spend and tokens per day, with spend by provider for each day
  - totals by provider, model, span type, step, project and feature, and the cache-hit rate
  - runs: their count, failure rate, first-pass rate (the run reached the human with one coder call), climb rate (the coder used more than one model) and median time
  - reliability: stalls, repeat loops (loop-judge spans that found the agent stuck) and failed tool calls
  - PRs: cost and agent time per task with a PR (a `pr` span is written when the PR opens)
  - gates: their count and the wait time
  - review turns and their cost
  - **call grading**, one row per task class and first coder model:
    - `right`: the first model passes first time in 80% or more of runs
    - `too-weak`: the task moves to another model in more than 30% of runs
    - `try-cheaper`: every run passes first time over 5 or more runs
    - `too-few`: fewer than 3 runs
    - `mixed`: none of the above
- **`GetInbox`** returns everything that waits on you, across projects. One rule decides it (`packages/core/src/inbox.ts`): an item waits on you when its next step needs your decision and no agent works on it. The kinds:
  - `gate`: a task at the approval gate. A runtime verdict other than `yes` is shown on it.
  - `blocked`: the classifier needs an answer.
  - `failed`: a failed task, feature step or ticket.
  - `question`: a grill question.
  - `approve-spec` and `approve-board`.
  - `merge`: a ticket with several blockers, which waits for their PRs to merge.
  - `qa`: the QA plan is ready.
  - `review`: a finished PR review.
  - `tending`: tending stopped on a PR.
- **`DismissInboxItem`** (`json: { id }`) hides an item until it waits again for a new reason. The item ID includes the time the item began to wait.

## PR tending

Tending is off by default. Turn it on in the project settings with `"tending": { "enabled": true, "answer_threads": false }`. Every 10 minutes the backend checks each task in `pr-opened` and does one action (`nextTendAction` in `packages/core/src/tending.ts`), in this order:

1. **The PR is merged or closed:** tending ends for that PR.
2. **The PR conflicts with its base:** tending merges the base in. An agent resolves the conflicts, and the merge is committed.
3. **Review threads wait for an answer:** this happens only with `answer_threads` on. An agent replies to each thread and changes code where it agrees with the comment. A thread is resolved only when its code change was pushed.
4. **Checks failed:** tending reruns the failed jobs once for each head commit. If they fail again, an agent fixes the cause from the failed logs.
5. **Otherwise:** tending waits.

Safety rules:

- Agents run with the coder's worktree guard and cannot commit, push or post.
- The backend first fast-forwards to the PR head and refuses a branch that has diverged.
- The backend pushes only new commits on top of the head, and only after the profile's `test` command passes. A failed fix is reset.
- Tending never force-pushes and never merges the PR.
- After 3 fixes without a green PR, tending stops and the PR goes to the inbox. `TendPullRequests` (`project`, `id`) tends one PR now and resumes a stopped one. With an empty `id`, it runs one pass over all PRs.

Each tending model call is a `model` span with step `tend:<action>`, under the task's ID and PR. The state of each PR is in `<project>/tasks/<id>/tending.json`.

## Communication and configuration

The versioned contract is `packages/backend-client/factory.proto`. Explicit commands use protobuf fields; canonical task/project snapshots are JSON envelopes validated with the existing Zod schemas, avoiding a second task-record definition. Regenerate the checked-in portable descriptor with `pnpm rpc:generate` after changing the proto.

Next.js and the CLI use one reusable gRPC channel and deadline-bound requests. The web client keeps its channel across development module reloads. The server binds loopback only and requires a bearer credential on every RPC. The local client reads the same data root's token file, or both processes can use `FACTORY_BACKEND_TOKEN` (at least 32 characters).

Optional backend settings: `FACTORY_BACKEND_PORT` (4319) and `FACTORY_HEALTH_PORT` (4318). Clients use `FACTORY_BACKEND_PORT` too; `FACTORY_BACKEND_ADDRESS=127.0.0.1:<port>` explicitly overrides it. The web health panel and settings also honor `FACTORY_HEALTH_PORT`. Next.js and the backend must run on the same local machine.

Task reads, submissions, execution, progress, environment/profile diagnostics, contributor history and team assignment updates all use gRPC. Next.js neither launches workflow/diagnostic processes nor reads or writes repository/team files. The shared contributor parser stays pure in the core; assignment updates are serialized by an Effect semaphore and written atomically. A missing backend is an explicit error; web actions never fall back to competing CLI workers.

## Interruption and recovery

Shutdown stops acceptance and lets running runs finish for `FACTORY_DRAIN_GRACE_MS` (default 5 min), then aborts their model calls and checks; the run is recorded as failed with the reason, and running the task again continues from the last saved step. Runs still queued are not started during shutdown. On the next start the backend settles what the previous one left: a run that was queued is queued again, a run that was running is marked `interrupted` and its `coding`/`reviewing` task is set to `failed` so it can run again. In file mode a task's `command.lock` is removed only when the process that wrote it no longer exists. An in-process PR review turn ends at shutdown without an exit file, so it reads as `interrupted`; its session is saved, and a reply continues it. A detached review turn (`FACTORY_REVIEW_TRANSPORT=cli`, or Codex) is a separate process and keeps running across a restart.

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
