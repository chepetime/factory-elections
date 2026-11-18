# Terminal workflow

1. Confirm `pwd` and `git status --short` in the assigned worktree.
2. Locate files with `rg --files <package>`; search the relevant symbol with `rg -n <symbol> <package>`. Read the matching range before expanding scope.
3. Run the smallest check that exercises the changed behavior. A pure package test runs as `node --test packages/<package>/test/<name>.test.ts`; web uses Vitest, described in [browser checks](BROWSER.md).
4. Use [changed CI checks](../agents/ci.md) for cross-package changes. `pnpm check` is the full fallback when scope cannot be established.

Capture verbose command output in a session-specific temporary log and retain the command's actual exit status. Print a short failure excerpt and log path; expand only when diagnosis needs more. A filtered log with no matches is not proof of success. Batch independent reads; keep edits and dependent checks sequential.

Repeat a passing check only after a relevant edit or new evidence. After the same failure repeats, inspect its cause or change the hypothesis before retrying. Keep generated logs, request transcripts and dependencies out of exploratory searches unless they are the subject of the task. Preserve raw evidence without pasting it wholesale into the conversation.
