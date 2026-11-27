---
name: factory-dev-loop
description: The change loop for this repository from start to running code - worktree, build the change, check, land on main, restart the stack safely, and look at the result. Use when implementing any change in factory-elections, when asked to restart the factory, take a screenshot of a page, inspect a ticket, review or span, or debug why an agent turn failed.
---

# Factory dev loop

Each step names the command. Do not rebuild these by hand.

## 1. Start

- The SessionStart hook already printed the stack state (running, commit, busy runs). Read it; do not probe again.
- Create a worktree: `node scripts/worktree.mjs new agent/<task> HEAD --install`. It also builds `affect-ui`, so `tsc` errors are real.
- Wide search over many files (for example "what data backs these 7 pages"): send one Explore agent and keep only its map. Read the files yourself only when you edit them.

## 2. Build the change

- Recipes for common changes: `docs/harnes/RECIPES.md` (add an RPC, add a rail page, where data lives).
- The RPC list is `packages/backend-client/src/rpcs.ts` only. Then run `pnpm rpc:generate`.
- Response shapes come from core schemas (for example `MetricsSummarySchema`). Do not copy them into the web app.
- The PostToolUse hook formats each edited file. Do not run Prettier by hand.

## 3. Check

- Focused tests first: `node --test <file>` (packages) or `pnpm exec vitest run --project unit <file>` (in `apps/web`).
- Then `pnpm check` once. `pnpm lint` includes `scripts/unused-files.mjs`: delete a file nobody imports.

- Git hooks (`pnpm run setup` sets `core.hooksPath scripts/git-hooks`): pre-commit runs Prettier and oxlint on staged files and blocks. Do not use `--no-verify`; only the factory's own commits do. After a commit lands on `main`, post-commit checks it in a detached worktree and appends to `$FACTORY_ROOT/logs/main-checks.jsonl`; the SessionStart hook prints the last result. See `docs/agents/ci.md`.

## 4. See it

- Against the main stack: `pnpm shot <path> [--selector '#panel-…']`. It prints the PNG path and any alert text.
- Against this worktree's own stack: `pnpm worktree run <web> <backend>`, then `FACTORY_BACKEND_PORT=<backend> pnpm seed:demo`, then `PORT=<web> pnpm shot <path>`.

## 5. Land and restart

- Commit in the worktree, then run `git merge --ff-only agent/<task>` in the primary checkout. Run `pnpm install --frozen-lockfile` there when packages changed.
- `pnpm restart --dry-run`, then `pnpm restart`, from the primary checkout. It refuses while runs work or wait, drains, starts detached and waits until up. Report a cut run if `--force` was needed.
- It refuses inside a Claude Code session unless `--from-agent-session`. Agent turns started that way can run with this session's permission limits (PR reviews then fail to save their report). Prefer the launchd service (`node scripts/service.mjs install`, run by the user in a terminal); `pnpm restart` then uses it.
- Remove the worktree: `git clean -fdXq` in it, then `node scripts/worktree.mjs remove agent/<task>`.

## Debug

- `pnpm -s factory paths`: data root, logs, review and task folders, ports.
- `pnpm -s factory issue show --project <p> --key <KEY>`: a ticket with its events.
- `pnpm -s factory review diagnose --project <p> --number <n>`: each review turn's exit, permission mode, CLI version, refused calls and cost.
- `pnpm -s factory spans --type tool|model|review [--project <p>]`: the newest spans.

## Limits

- Never strip `CLAUDE_CODE_*` variables or add allow-all permission guards to get past this session's limits. Ask the user.
- Do not run `pnpm data:up` from a worktree.
