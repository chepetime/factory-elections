# CI and delivery

- Preview impact: `node scripts/ci-plan.mjs origin/main HEAD`.
- Run affected validation: `node scripts/ci-run.mjs origin/main HEAD`.
- Validate the selector: `node --test scripts/ci-plan.test.mjs`.

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

The workflow always emits `CI / checks`, including documentation-only PRs; require
this check in branch protection. CI runs on PRs, not branch pushes, and cancels stale
runs. Tests are never cached. pnpm's content-addressed store is cached by the lockfile,
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

No CI timing baseline exists yet. Compare Actions durations and selected test counts
on equivalent PRs before claiming speed improvements. Storybook/browser tests and
data integration checks remain explicit task-specific checks, as in the existing
local check command; these workflows do not claim to cover them.
