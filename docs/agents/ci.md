# CI and delivery

- Preview impact: `node scripts/ci-plan.mjs origin/main HEAD`.
- Run affected validation: `node scripts/ci-run.mjs origin/main HEAD`. Add `--part=node|web-check|web-build` to run one CI job's part.
- Validate the selector: `node --test scripts/ci-plan.test.mjs`.
- Validate the file-size ratchet: `node --test scripts/file-size-ratchet.test.mjs` (`pnpm test` does not run `scripts/*.test.mjs`).

## File-size ratchet

`pnpm check:file-size` (also part of `pnpm lint`) caps production source at 1000 lines per file.
Tests, stories, e2e, `.d.ts` and `apps/docs/` are out of scope.
`file-size-baseline.json` lists the files already over the cap with their line counts. A baseline file
may only shrink; a file not in the baseline fails once it passes 1000 lines. Deleted files pass.

`node scripts/file-size-ratchet.mjs --update` lowers entries for shrunk files and drops files that
reach 1000 or fewer. It refuses to run while the check fails, never raises an entry, and on a branch
changes only the entries of files changed since local `main` (on `main` it considers every entry).

When the check fails, move a cohesive part of the file into its own module. Do not raise the baseline.
After a rename or move, move the baseline entry to the new path by hand.

Repository rules live in `tests/repo/*.test.ts` (`node:test`, Node built-ins only): relative links in
`AGENTS.md` and `docs/harnes/*.md` resolve, factory `git commit` calls pass `--no-verify`, and each
hook script in `.claude/settings.json` exists. `pnpm test` and `ci-run.mjs` run them on every plan,
also a documentation-only one; run them alone with `node --test tests/repo`. A new file under
`tests/` is an unknown path to `ci-plan.mjs`, so it selects all workspaces.

## Local git hooks

Work lands directly on local `main` with no PR and no push, so neither workflow runs. Git hooks cover that gap.
`pnpm run setup` runs `git config core.hooksPath scripts/git-hooks` (safe to rerun; `--no-hooks` skips it). The path is relative, so every worktree uses the hooks of its own checkout and they cannot go stale. The launchers in `scripts/git-hooks/` only call checked-in runners.

- **pre-commit** (`scripts/run-pre-commit.mjs`, blocks, a few seconds): `prettier --check` and `oxlint --deny-warnings` on the staged files only.
- **post-commit** (`scripts/run-post-commit.mjs`, advisory, branch `main` only): detaches, then runs `node scripts/ci-run.mjs <base> <sha>` in a disposable detached worktree at the commit, after `pnpm install --frozen-lockfile --offline`. The commit tree is checked, never the shared checkout's unstaged edits. It appends `{sha, base, outcome, failedStep, log, ...}` to `$FACTORY_ROOT/logs/main-checks.jsonl`; the output is in `logs/main-check-<sha>.log`. `outcome` is `passed`, `failed` or `error` (the check could not run). The SessionStart hook prints the last result.
- Several commits in a row: one check runs at a time (a lock in `logs/`); when it ends it checks only the newest main head. The base is the newest passed ancestor, else the first parent (merge commits), else `--all` (root commit). Worktrees older than three hours are swept.

`--no-verify` skips pre-commit only; post-commit still runs. Use it only for commits the factory itself makes (`packages/adapters-git`, `packages/backend/src/tending.ts`); a person or agent that skips pre-commit must run `pnpm format:check && pnpm lint` first. A `failed` line in the session status means main is broken: fix it before starting new work from that head.

PR CI compares the merge base with the checked-out PR merge commit, including changes
introduced by merging the current base. Workspace manifests and relative source/test imports define dependencies;
reverse traversal includes all transitive consumers, including test dependencies.
Node tests run once per affected workspace; web unit tests and the production build run
only when web or a dependency changes. `pnpm check` also ends with the web build, because
route-structure and server/client boundary errors appear only in `next build`. Root TypeScript remains one program, so code changes retain its
whole-program check. Formatting and lint are also repository-wide. Manual CI dispatch runs all checks. Unknown/shared inputs select all
workspaces. Deleted paths use `--no-renames`, retaining both sides of moves.
Markdown under `docs/`, root Markdown and AGENTS files skips application tests.
Prompt files under `definitions/` remain application inputs.

PR CI runs three parallel jobs, one per `ci-run.mjs` part: `node` (repository rules, format, lint,
root TypeScript, Node tests, harness tests), `web-check` (web TypeScript and unit tests) and
`web-build` (`next build`). Each job plans for itself; a web job with no web inputs skips its
install. The `checks` job needs all three and fails unless all passed (also when one is cancelled),
so the workflow always emits `CI / checks`, including documentation-only PRs; require this
check in branch protection. CI runs on PRs, not branch pushes, and cancels stale runs.

Tests are never cached. Tool caches are: prettier results by file content and tsc build info
(`node_modules/.cache/factory-ci`, `apps/web/tsconfig.tsbuildinfo`), and the Next.js compiler
cache under the delivery build's key family, so a PR starts from the newest main build.
Keep `node --test` files small: files run in parallel, the tests inside one file do not, so the
slowest file sets the floor of the `node` job. pnpm's content-addressed store is cached by the lockfile,
then a frozen install verifies the checkout. No dependency directory is shared across
worktrees. See [setup-node caching](https://github.com/actions/setup-node#caching-global-packages-data)
and [pnpm setup](https://github.com/pnpm/action-setup).

Main pushes run a delivery build only when web inputs changed, comparing the previous
push SHA directly with HEAD. Manual delivery builds are limited to main. The Next.js
compiler cache is scoped to OS, Node major and lockfile. Build artifacts are named by
commit, retained seven days, and exclude the compiler cache. This does not rerun PR
tests. Require PR checks before merging; direct main pushes bypass that validation.

No deployment target, credentials, or existing CD configuration exists in this
repository. Delivery therefore stops at a web build artifact, which is **not** a
standalone runtime bundle. A host-specific deploy step and protected environment
must be configured before production deployment; it must consume the validated
commit, supply runtime dependencies, and keep production secrets out of PR jobs.

Baseline before the parallel jobs (2026-11-26, full plan, one job): 130–195 s per PR run. The
validate step took 103–162 s: Node tests 40–55 s (one 40 s file), `next build` 45 s with no compiler
cache, web typecheck 18 s and web tests 16 s (each then with its own affect-ui build, since removed), format 5–8 s.
Compare Actions durations and selected test counts on equivalent PRs before claiming further speed improvements. Storybook/browser tests and
data integration checks remain explicit task-specific checks, as in the existing
local check command; these workflows do not claim to cover them.
