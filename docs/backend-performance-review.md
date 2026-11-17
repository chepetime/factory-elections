# Backend and CLI performance review

Date: 2026-11-16. This records the initial optimization review; the subsequent [local backend implementation](local-backend.md) resolves the CLI bridge and server-ownership portion of the follow-ups below. Scope: CLI composition, filesystem storage, process execution, git adapter, model adapter, workflow driver and the web app's CLI bridge. No live model calls, pushes or PR creation were used for this review.

## Changes implemented

| Finding | Adjustment | Effect |
| --- | --- | --- |
| Every CLI invocation imported the Claude SDK and YAML parser, including JSON reads and help. | Load the SDK on the first model call; load YAML parsing and profile drafting when needed. | Less startup work on every web read and CLI read. |
| Verification accumulated every log chunk, while the process adapter also retained both streams. Only a short tail was persisted afterward. | Add optional bounded process capture; verification disables duplicate capture and retains the last 6,000 characters. | Captured output memory is bounded independently of total command output. Full logs still stream. |
| Atomic JSON replacement did not serialize commands. A web-started run and a CLI mutation could overwrite one another or operate on the same worktree. | Exclusive per-task `command.lock` around all CLI commands that mutate a record or worktree, including verification and PR creation. | A conflicting command fails before starting work. Reads remain available. |
| Classification wrote its verdict and then separately wrote attempt/cost evidence. | Persist both in one atomic write. | One fewer write and no intermediate verdict without an attempt. |
| `task run` could restart reviewed, approved, rejected or PR-opened work. | Reject these stages before calling any model. | Prevents accidental spending and changes after a human decision. Revisions use the existing revise command. |
| Process chunks were decoded separately and stdin errors were unhandled. | Use stream UTF-8 decoding and handle stdin errors, including EPIPE. | Split multibyte characters survive, and an early child exit does not crash the CLI. |
| Worktree validation resolved the two repositories sequentially. | Resolve both independent git identities concurrently. | Removes one serial git lookup from each validation. |

The capture limit counts UTF-16 characters, consistent with the driver's existing output-tail contract. It does not bound arbitrary subprocess memory, full git diffs, or downstream log sinks. Default process capture remains complete so git/JSON consumers do not silently receive truncated results. The stream decoding/error handling follows [Node's child-process interfaces](https://nodejs.org/api/child_process.html).

## Measurements and validation

On this Mac, Node v26.13.1, seven fresh-process invocations per command, same empty data root:

| Command | Before median | After median | Reduction |
| --- | ---: | ---: | ---: |
| `--help` | 134.9 ms | 95.7 ms | 29% |
| `project list` | 136.0 ms | 96.5 ms | 29% |

These measure process startup and local reads with warm filesystem caches. They do not measure end-to-end model latency or establish a production latency budget. Run `node scripts/benchmark-cli.mjs [samples]` to reproduce startup measurements using an isolated temporary data root. Avoid running benchmarks alongside tests or builds.

Regression coverage includes four million characters of stdout/stderr with bounded capture and complete forwarding; zero/default capture; split UTF-8 output; spawn failure; early stdin close; cross-process CLI exclusion and lock release after an exception; bounded verification output; no model calls when rerunning a reviewed/approved task; and classification's single write. Existing real-git workflow and CLI integration tests cover approval, revision, verification and PR gates.

## Lock ownership and interruption

`<task-directory>/command.lock` contains the owning CLI PID. It is acquired exclusively using `wx`; normal completion and handled failures remove it. A hard kill leaves the lock behind. There is deliberately no timeout-based stealing: model and verification calls can legitimately run for minutes. Confirm the recorded process and its child work have stopped before manually removing a stale lock. On a shared/network filesystem, exclusive creation semantics must be verified; this implementation targets local storage, consistent with [Node's filesystem caveats](https://nodejs.org/api/fs.html).

This is an entry-point guarantee: direct users of `Driver` or `TaskStore.write` must provide their own serialization. The future server must use the same exclusion mechanism during migration. Locks do not prevent someone manually editing task records or a worktree. No automatic step recovery or safe cancellation is added in this round.

## Remaining bottlenecks and correctness work

1. `apps/web/src/lib/factory.ts` still creates a process per read and polls full records. `backgroundRun` synchronously reads the entire log before slicing its tail. Server reads and offset-based log streaming should replace this bridge.
2. Project/task lists scan and validate every full JSON record sequentially. Introduce cursor-based summary reads and bounded parallel I/O after measuring representative collections; avoid an unbounded `Promise.all` over every task. Keep full task detail on demand.
3. Reviewer and PR-writer capture full git diffs before truncating prompts, and run separate model calls. Bounded diff capture must explicitly mark truncation; never truncate ordinary git output silently. Reuse a diff only when keyed by both immutable base and head commits.
4. Long-running subprocesses have no deadline, abort propagation or process-tree ownership. Quiet CLI output also does not imply backpressure-aware streaming. These belong in the server worker lifecycle.
5. Stage transitions are not uniformly guarded across every individual-step command. Add a shared command policy before exposing a mutation API. Current command locks prevent overlap, not all invalid sequences.
6. Verification associates its result with the head read after commands finish. Capture and compare the starting head too, and reject any command that changes it. Base branches also move: record an immutable base commit before adding caches or automatic resume.
7. Model failures are not recorded consistently: reviewer exceptions omit attempts, and commit failures can leave `coding` without complete evidence. Standardize attempt finalization before adding automatic retries.
8. A successful GitHub PR creation followed by a failed record write can create duplicate PRs on retry. Reconcile the branch's existing PR before repeating the external action.

The server proposal is [ADR 0003](adr/0003-local-backend-service.md). These remaining items are follow-up work, not claims that the current CLI already implements recovery, pagination or a dispatcher.
