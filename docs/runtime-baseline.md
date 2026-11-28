# Runtime baseline

Phase 0 of the [roadmap](vision/roadmap.md). This page records what each provider entry point did on 24 Nov 2026 in real runs. Later phases compare against it.

`node scripts/capture-provider-fixtures.ts [claude-sdk|claude-cli|codex|codex-app-server]` runs the scenarios again. It calls paid models (a few cents) and never runs in CI. It writes sanitized fixtures to `packages/adapters-claude/test/fixtures/` and `packages/adapters-codex/test/fixtures/`, and the fixture tests replay them through the parsers. When you capture again for a new version, update `TESTED_RUNTIMES` in `packages/core/src/agents.ts`.

## Versions

| Entry point | Used for | Binary |
| --- | --- | --- |
| Claude Agent SDK 0.3.323 | Workflow steps (coder, classifier, planning) | Bundled Claude Code 2.1.323 |
| `claude -p --output-format stream-json` | Detached PR review and chat turns | Claude Code 2.1.331 on PATH |
| `codex exec --json` | Codex steps and detached Codex turns | codex-cli 0.172.0 on PATH |

The two Claude paths run different Claude Code versions. A fix verified on one path does not prove the other.

## Scenarios

Each scenario ran in an empty temporary directory, on Haiku for Claude and low effort for Codex.

| Scenario | Claude SDK | Claude CLI (detached) | Codex exec |
| --- | --- | --- | --- |
| Tool turn: call IDs pair calls and results | Yes (`tool_use_id`) | Yes (`tool_use_id`) | Yes (item id) |
| Resume after a finished turn | Same session | Same session | Same thread |
| Cancel 2 s into `sleep` | `aborted`; the call returned 5.4–5.6 s after it started | Exited within one 0.25 s poll after SIGTERM | `aborted`; the call returned 6.2–7.2 s after it started |
| `sleep` still alive 7 s after cancel | No | No | **Yes** |
| Exit evidence after cancel | Error kind `aborted` | **No exit file**: the wrapper shell dies with the group | Error kind `aborted` |
| Stream after cancel | Started tool call, no result | Started tool call, no result | Started tool call, no result |
| stderr on a normal turn | Not captured by the SDK | Merged into the log file | Two lines: a stdin notice and a skill-load error |

The time from abort to return was not measured apart from model latency. Phase 4 adds cancellation latency as a metric.

## Findings

1. **Codex cancel leaves the shell tool running.** The runner stops the `codex` process group, but the command Codex started outlives it. The acceptance test "Cancel during a shell tool" fails for Codex: the descendant is not stopped, and nothing reports cleanup as uncertain. Phase 2 (native interrupt) and phase 4 (cleanup records) must close this.
2. **(Closed in phase 3.) SDK tasks receive skills the factory did not choose.** With `settingSources: []`, the init message lists 17 skills and 53 slash commands. The detached CLI path, with `--setting-sources project --disable-slash-commands`, lists none. Phase 4's configuration manifest must show these, and the SDK path needs an explicit way to exclude them.
3. **Codex loads user skills despite `--ignore-user-config`.** stderr shows `failed to load skill <home>/.agents/skills/…`. User-level skills reach Codex turns.
4. **A stopped detached review turn leaves no exit code.** `spawnDetached` writes the exit file from the wrapper shell, and `stopGroup` kills that shell too. The backend cannot tell "stopped by us" from "died". Phase 3 removes this path. Until then, a stop must be recorded on the review record.
5. **Both Claude paths load the same built-in plugins** (`cc-plugin-sec-default`, `cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-privacy`, `cc-plugin-plugin-authoring`). No setting tested here removes them.

## Fixed in this baseline

- Rate-limit retry now needs evidence of no activity, not `!error.costUsd`.
- Codex progress comes only from stdout protocol events; stderr and non-JSON lines do not renew the stall timer.
- Tool events carry native call and parent-call IDs. Tool spans and session digests pair by ID.

## In-process review turns (phase 3)

A real turn on 24 Nov 2026 ran `runClaudeTurn` (SDK 0.3.323, bundled Claude Code 2.1.323) with the automated-turn deny rules, on Haiku in an empty directory.

| Check | Result |
| --- | --- |
| `gh api rate_limit` under `Bash(gh api:*)` with `bypassPermissions` | Denied: "Permission to use Bash with command gh api rate_limit has been denied." |
| Skills and slash commands (`skills: []`, `--disable-slash-commands`) | 0 and 0 |
| Tools | 24 (the CLI path listed 25) |
| Cancel 2 s into a shell tool | Aborted; no leftover process after 7 s |

SDK tasks now also set `skills: []` and `--disable-slash-commands`, so finding 2 is closed. The capture script runs `echo waiting && sleep <marker>`, because Claude Code 2.1.323 blocked a standalone `sleep` once and ran it in the background.

## App-server (phase 2)

`FACTORY_CODEX_TRANSPORT=app-server` selects `CodexAppServerRunner` (`packages/adapters-codex/src/app-server.ts`). The default stays `codex exec` for ordinary calls. Board tasks use app-server for its streaming token limit, disable the native shell, and route commands through Factory’s guarded MCP tool. The runner drives `codex app-server` over stdio JSON-RPC. `packages/adapters-codex/protocol/` has the schema parts it uses.

`node scripts/capture-provider-fixtures.ts codex-app-server` runs the scenarios through the runner. It writes `app-server-*.jsonl` fixtures. Three runs on 24 Nov 2026, codex-cli 0.172.0, low effort:

| Scenario | Codex exec (above) | Codex app-server |
| --- | --- | --- |
| Tool turn: call IDs pair calls and results | Yes (item id) | Yes (item id) |
| Resume after a finished turn | Same thread | Same thread |
| Resume of a thread that does not exist | Not tested | JSON-RPC error `-32600` ("no rollout found"). The runner throws `CodexResumeRejected` and starts no new thread |
| Cancel 2 s into `sleep` | `aborted`; the call returned 6.2–7.2 s after it started | `aborted`; the call returned 6.9–7.9 s after it started, and 77–83 ms after the abort |
| Native interrupt acknowledged | No native interrupt | Yes: `turn/interrupt` answers `{}`, then `turn/completed` has status `interrupted` |
| `sleep` alive when the turn reported its end | Not measured | **Yes** (1 process) |
| `sleep` alive 7 s after cancel | **Yes** | No |
| Processes under the server at the stop / still alive after it closed | Not checked | 4 / 0 |
| Cleanup the runner reports | `uncertain` | `clean` |
| Stream after cancel | Started tool call, no result | Started tool call, no result, then an interrupted result |
| stderr on a normal turn | Two lines: a stdin notice and a skill-load error | One line: the same skill-load error (tracing output with colors) |

### App-server findings

1. **The native interrupt ends the turn, not the command.** `sleep` still runs when `turn/completed` arrives. It stops when the server exits after stdin closes. So the runner always closes the server after a stop. Then it compares the process tree from before the close with what is still alive. It stops any survivor itself, and reports `clean` only when none is left. If `ps` fails, it reports `uncertain`.
2. **app-server has no `--ignore-user-config`.** It exits with "unexpected argument". The user's `config.toml` loads. The runner sets approval, sandbox, model and instructions on each thread, so those user settings do not apply. User MCP servers still start (`node_repl` and `cua_repl` on this machine), and `-c mcp_servers={}` does not remove them. User skills still load (finding 3). This is weaker isolation than `codex exec`.
3. **`turn/completed` has no usage.** Usage comes from `thread/tokenUsage/updated`, and its `total` is for the whole thread. A resumed thread first sends the totals of its earlier turn. The runner reports the totals at the end minus the totals before the turn.
4. **Progress is the turn's own protocol activity.** Responses, and notifications or requests for the turn's thread, count. Account, rate-limit and other server-wide notices, non-JSON lines and stderr do not. A usage snapshot that repeats the last one does not count either.
5. **No approval request came** with approval policy `never`. The runner declines every approval, question and elicitation the same way, and refuses a guarded step.
6. **Extra input is possible in the protocol** (`turn/steer` with `expectedTurnId`), but the runner does not use it. `supplementalInput` stays `false`.

## Not covered yet

- UTF-8 split across chunks is covered by a process test (`packages/adapters-process/test/process.test.ts`), not by a real provider stream.
- Interrupt during model output (as opposed to during a tool) was not captured.
- A rate limit was not provoked. The retry rule is covered only by unit tests.

## Spend limits

- Claude stops a call at `maxBudgetUsd` itself (`error_max_budget_usd`, kind `budget`). A Claude turn reports the same stop as `kind: "budget"` on its result.
- Codex reports tokens, not dollars. The app-server transport (`tokenCap: true`) interrupts the turn once input plus output tokens pass `maxTokens`, and fails with kind `budget`. Spans are priced from tokens with the table in `packages/core/src/prices.ts`; a model not in the table has unknown cost (null, not $0). The router turns a dollar limit into that cap at the model's dearest rate (`tokenCapForModel`), and refuses a model with no price. The exec transport sees usage only at `turn.completed`, so it has `tokenCap: false` and the router refuses a Codex call that has a limit.
- Overshoot: the cap is checked on each `thread/tokenUsage/updated`, so a turn can pass it by what one update adds before the interrupt lands. Not measured against a real server.
- Manual run with a $0.05 limit on the real Claude SDK: not done. The agent session that wrote this had no model credentials or network. Run one and record the cost here: the overshoot is `total_cost_usd - 0.05`.
