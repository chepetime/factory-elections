# Project handoff

## Goal

A version that can be cloned and run locally on macOS, taking a task through intake, classification, coding in an isolated worktree, verification, review, human approval and pull-request creation, with documented installation, configuration, features, limitations and troubleshooting.

## Status (2026-11-13)

The CLI loop is implemented and documented in the [README](../README.md).

- **Verified with real models**, against a throwaway local repository: intake → Haiku classification → Sonnet coding in a worktree → verification → Sonnet review → approval gate → `revise` with a human note → re-review → `approve` bound to the head commit → `open-pr` pushed the branch to the remote. Two tasks took about 20 seconds and $0.30 each.
- **Verified on GitHub** (2026-11-13), using this repository as the target: a task to add a pnpm check to `factory doctor` went through classify, code, verify (`pnpm run check`), review, `revise` with the reviewer's two minor findings, re-review, owner approval of the reviewed commit, and `open-pr --draft`. The result is [draft PR #1](https://github.com/chepetime/factory-elections/pull/1); its head matches the approved commit. It took about 3 minutes and $1.33 in five model attempts.
- **Verified from a fresh clone** (Node 26.13.1, pnpm 12.18.0): `pnpm install --frozen-lockfile`, `./bin/factory --help`, `doctor`, and `pnpm check` (22 CLI and 21 web tests pass). The test suite makes no model, GitHub or network calls.
- **Web app** (`pnpm web`, `apps/web`): built from `frontend.plain` and extended with a task page and the gate actions. In Chrome against the demo data, these were checked live: the home page, health panel, project and task pages, the gate view, and a Revise submitted from the browser. The revision ran with real models in the background while the page refreshed itself, and the new commit appeared on the Approve button. Approve and Open PR from the browser were left for the owner to click, since approval is the human's gate. Those buttons run the same CLI commands verified above. The proxy rejects foreign `Host` headers and writes without `Origin` (403, checked with curl).
- **Not built:** every feature marked as planned in the [feature inventory](feature-inventory.md).

## Source of truth and turri

`factory.plain` specifies the CLI, including the workflow commands added in v1, and `frontend.plain` specifies the web app. Files under `resources/` are part of the specs. turri, the renderer these specs were written for, was not available on the continuing machine and has no public install source. The owner chose to write v1 by hand; see [ADR 0002](adr/0002-hand-written-v1.md). Change the specs alongside the code.

If turri returns, don't render over the hand-written tree blindly; reconcile them. The earlier turri issue (unit-test script exceeding a 120-second limit while installing into a fresh isolated pnpm store) was never resolved and does not affect `pnpm test`.

## Suggested next steps

See [TODO.md](../TODO.md).

Do not put credentials, task data or machine-specific paths into the repository.
