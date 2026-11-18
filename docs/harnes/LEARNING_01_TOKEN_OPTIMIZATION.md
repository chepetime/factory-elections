# Learning 01: Token optimization

Date: 2026-11-17. Baseline revision: `9105ab9`. Status: documentation and command-routing implementation; controlled session-cost comparison pending.

## Observations

The baseline has no root `AGENTS.md`. Its web `AGENTS.md` contains Next.js-generated guidance and is preserved: removing generated content would cause churn on startup. Adding the root router therefore increases explicit startup instructions; there is no honest before/after claim that root instruction tokens decreased. The intended saving is fewer exploratory reads and repeated command discoveries.

Run `node scripts/harness-stats.mjs` from any directory to measure the root router, scoped web instructions and four task guides and check their Markdown pointers. Byte counts are exact; the characters/4 token estimate is a rough size proxy, not provider tokenization. Do not sum every task guide as normal startup cost: only load the guide needed for the task. Conversely, include both root and scoped instructions when measuring a web task.

## Adapted sources

These are pattern adaptations, not copied code or imported host configuration:

| Source inspected | Adopted here | Deliberately left out |
| --- | --- | --- |
| `~/Projects/personal/devin-factory/AGENTS.md` | Owning-layer map, focused checks, explicit browser evidence | Its different workflows, data layout and release commands |
| `~/Projects/elections/change-elections/AGENTS.md` | Task pointers, bounded reads, absolute worktree command paths | Its infrastructure restrictions, model names and service topology |
| `~/Projects/personal/cooking-drama-platform/AGENTS.md` | Per-checkout runtime awareness, actual exit-status evidence, focused browser checks | Its database/Cloudflare machinery and commit-only verification policy |
| [Microsoft TokenEconomizer README](https://github.com/microsoft/TokenEconomizer) | Reusable facts, selective tools, failure-loop redirection, measured cost including overhead | Automatic plugin installation or user-wide tool changes |

TokenEconomizer describes learning repeated repository facts, pruning unused tools reversibly and redirecting repeated failure loops. This repository already has related runtime memory, review-tool pruning and SDK loop-guard mechanisms documented in [local backend](../local-backend.md). The contributor harness reuses those principles through task guides; it does not install another competing runtime layer. Upstream benchmark savings are not measurements of this repository.

## Experiment protocol

Use the same revision and model for paired sessions, with a clean isolated worktree and equivalent environment. Run each pair at least three times to expose variance:

1. Locate and run a backend unit test.
2. Start fullstack and verify the health response and one page.
3. Change a component and verify its focused browser interaction.
4. Explain the affected checks for a documentation-only PR and a core change.

Control sessions receive baseline repository instructions; treatment sessions receive the router and relevant task guide. Record task success with the same checks, commands executed, files/bytes read, input tokens, cached input tokens, output tokens, wall time and billed cost where available. Record skill and tool-definition exposure separately from tool calls. Not invoking an MCP tool does not prove its schema was absent from context. Host-level pruning requires host configuration and a fresh session; this change does not alter personal configuration.

Use a table with one row per session: `task, arm, revision, model, success, input, cached_input, output, cost, elapsed, reads, tools, notes`. Unknown metrics remain unknown. Include setup, judge and retry overhead; compare successful completion rates before claiming savings.

## Current result and next decision

Implemented deterministic command pointers, task-specific reference files and a size/pointer measurement command. Session input/output savings and CI wall-clock/cache improvements remain unmeasured until paired agent runs and hosted CI runs occur. Keep a guide only if it reduces rediscovery without hiding required checks; promote common command discoveries after repeated confirmation. Concise final reports should state outcome, checks and unresolved limits rather than replaying the tool transcript.
