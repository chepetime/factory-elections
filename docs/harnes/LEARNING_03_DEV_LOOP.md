# 03: Dev loop tooling

Revision: the `agent/dev-loop` commits (2026-11-26). Source: one long Claude Code session (Opus 5.5) that built about ten features and compacted once. Observed counts come from that session's tool calls; there is no token measurement yet.

## What repeated

| Work | Seen | Replaced by |
|---|---|---|
| Restart after each commit: busy check, SIGTERM, wait for the drain and lock, start, health | 5 times, about 4 calls each | `pnpm restart` (`--dry-run`, refuses busy runs and linked worktrees) |
| Screenshot with a new Playwright script | 4 scripts | `pnpm shot <path> [--selector]` |
| Read a ticket's events or a review's turn logs with one-off scripts | about 15 calls for one review failure | `pnpm -s factory issue show`, `review diagnose` |
| Adding an RPC in 6 files, found by search | 3 RPCs | `rpcs.ts` + `pnpm rpc:generate`; [recipe](RECIPES.md) |
| Web zod schemas copied from core types | 2 copies of the metrics shape | `MetricsSummarySchema` in core, type-checked against the type |
| False `tsc` errors in new worktrees (`affect-ui` not built) | every worktree | `worktree new --install` builds it |
| A dead component read as live (`EngineHealthPanel`) | 1 wrong pointer to the user | `scripts/unused-files.mjs` in `pnpm lint` |
| Formatting after edits | every commit | PostToolUse hook `scripts/hooks/format-edited.mjs` |
| Stack state at session start | every session | SessionStart hook `scripts/hooks/session-status.mjs` |

## Hypotheses to measure

- The session-start block and the skill cut the first 3–5 calls of a session.
- `review diagnose` turns a review failure into one call.
- A launchd service (`scripts/service.mjs`) removes agent-session permission caps on agent turns. Not proven: on 2026-11-26 a review turn ran in `default` mode with the stack started from a Claude Code session, and the test that would separate the two causes was not allowed.

## Limits

- knip was not added: running a package from the network was not allowed in the session. `unused-files.mjs` checks unused files only, not unused exports.
