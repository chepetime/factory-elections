# Project handoff

## Goal

A version that can be cloned and run locally on macOS, taking a task through intake, classification, coding in an isolated worktree, verification, review, human approval and pull-request creation, with documented installation, configuration, features, limitations and troubleshooting.

## Status (2026-11-13)

The CLI loop is implemented and documented in the [README](../README.md).

- **Verified with real models**, against a throwaway local repository: intake → Haiku classification → Sonnet coding in a worktree → verification → Sonnet review → approval gate → `revise` with a human note → re-review → `approve` bound to the head commit → `open-pr` pushed the branch to the remote. Two tasks took about 20 seconds and $0.30 each.
- **Not yet verified live:** `gh pr create` against a real GitHub repository. The local test remote wasn't GitHub, so `gh` refused cleanly and the task correctly stayed `approved`. The PR call itself is covered only by the end-to-end test with a fake GitHub.
- **Verified from a fresh clone:** `pnpm install --frozen-lockfile`, `./bin/factory --help`, `doctor`, and `pnpm check` (21 tests pass). The test suite makes no model, GitHub or network calls.
- **Not built:** the web app in `frontend.plain`, and every feature marked as planned in the [feature inventory](feature-inventory.md).

## Source of truth and turri

`factory.plain` specifies the CLI, including the workflow commands added in v1, and `frontend.plain` specifies the web app. Files under `resources/` are part of the specs. turri, the renderer these specs were written for, was not available on the continuing machine and has no public install source. The owner chose to write v1 by hand; see [ADR 0002](adr/0002-hand-written-v1.md). Change the specs alongside the code.

If turri returns, don't render over the hand-written tree blindly; reconcile them. The earlier turri issue (unit-test script exceeding a 120-second limit while installing into a fresh isolated pnpm store) was never resolved and does not affect `pnpm test`.

## Suggested next steps

1. Run one task against a real GitHub repository to confirm `open-pr` end to end.
2. Worktree cleanup command (`factory task cleanup`) for finished or rejected tasks.
3. Tighter shell sandboxing for the coder (the Agent SDK's `sandbox` option).
4. The web app from `frontend.plain`: read-only project, task and gate views first, over the CLI's JSON output.
5. Phase 2 of the plan: PR tending, research route, slicer.

Do not put credentials, task data or machine-specific paths into the repository.
