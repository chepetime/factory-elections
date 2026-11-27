# 04: Seeding worktrees with a cloned node_modules

## Change

`scripts/seed-node-modules.mjs <worktree> [source]` clones the main checkout's root and per-package `node_modules` with `cp -cR` (APFS copy-on-write), then runs `pnpm install --frozen-lockfile --offline` to fix links. `scripts/worktree.mjs new <branch> --install` uses it. It falls back to a normal frozen install off macOS, when `pnpm-lock.yaml` differs from the main checkout, when the source has no `node_modules`, or when the clone fails.

Run worktrees: set the repo profile's `commands.setup` to `node scripts/seed-node-modules.mjs .` (the profile lives outside the repo). The existing `setup_key` still skips setup when inputs are unchanged.

## Measurement (not yet recorded)

Needs the phase spans ticket. The agent sandbox cannot run `git worktree add`, so no before/after numbers exist yet. Protocol: create a worktree with `--install` on a branch with a matching lockfile, once with the old path (`pnpm install --frozen-lockfile`) and once with the seed script; record the script's `seed: cloned in Ns` line and the phase span for setup. Fill in here.

## Not done (follow-ups)

- Background install with an atomic `mkdir` lock and failure marker, and a PreToolUse hook that blocks `pnpm`/`git commit` until it finishes (`.claude/` and `.githooks/` are off limits to agent edits).
- Driver-side seeding in `addWorktree`, instead of the profile setup command.
