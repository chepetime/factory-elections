# TODO

Next steps for factory-elections, roughly in priority order. The README lists what works today; [docs/HANDOFF.md](docs/HANDOFF.md) has the background.

## Now

- [ ] **Decide task bb64645e** (LayerStack component on the web homepage). It is at the approval gate at `5750b1ee1546`, with verification passed and the review approved with 3 minor findings. Check the animation in a browser, then approve and open the PR, revise it or reject it. Its branch predates the affect-ui commit on `main`, so expect a conflict, mostly in `pnpm-lock.yaml`.
- [ ] **Use the new components in the web app:** `AgentFindings` for review findings and `AgentCheckpoints` for the stage timeline on the task page. Wait until the component work in the other session settles.

## Safety

- [ ] **Coder sandbox, next steps:** deny reads of secrets (`~/.ssh`, `~/.npmrc`, `~/.aws`, `~/.config/gh`, keychains) using `filesystem.denyRead` / `credentials`.
- [ ] **Per-profile sandbox settings:** extra allowed hosts (other registries, `git fetch`) and write paths, declared in the repo profile rather than hard-coded in `sandboxFor`.
- [ ] **Generated-files check:** let a profile add its own generated paths, such as `dist/` for repos that don't commit build output.
- [ ] Optionally sandbox the verification commands too. They currently run as your shell user.

## Workflow

- [ ] **LLM-generated task name:** the classifier should also return a short task name, stored on the task record and shown in the CLI and web app instead of the first line of the prompt or the UUID.
- [ ] **`factory task cleanup`:** remove worktrees and branches of tasks that are pr-opened, rejected or failed.
- [ ] **Rebase or refresh a task branch** when `main` moves on, so a PR doesn't start with conflicts (see bb64645e).
- [x] **Resume after a usage limit:** a usage-limit failure says to run the task again after the reset, and `run` continues at the reviewer when verification already passed. Still open: an automatic retry at the reset time.
- [x] **Cost guardrail:** `limits.task_budget_usd` in the profile (default $15) stops the ladder before the next model call; each call also gets its step's `budget_usd`.

## Web app

- [ ] **Chat-style task view:** show the task as a conversation (prompt, coder and reviewer turns, revise notes, approval) with a toggleable sidebar listing all task events.
- [ ] **Use the new components across the app:** the affect-ui free components (`packages/affect-ui`) and shadcn/ui, following [docs/frontend-component-patterns.md](docs/frontend-component-patterns.md), instead of hand-rolled markup.
- [ ] **Inbox:** tasks awaiting a decision across all projects, on the home page.
- [ ] **Render the approval gate's diff** with a proper code view (affect-ui `CodeBlock` / Tool Call Card patterns) instead of plain text.
- [ ] Show the task's cost and model attempts as a small breakdown.
- [ ] Replace the remaining placeholder cards with real views.
- [ ] Tests for `layer-stack.tsx` once bb64645e lands (the reviewer's nit).

## Later (plan phase 2)

- [ ] PR tending: follow review comments and CI on opened PRs.
- [ ] **Codex review turns:** they need deny rules that hold for wrapped commands. Options: a Codex rules file plus no network, or prefetched PR data.
- [ ] **Loop guard and context warnings for review turns and Codex:** they need tool hooks (a `--settings` hook command for detached Claude turns).
- [ ] **Resume a model step after a restart:** steps return a session id now; keep sessions (`persistSession`) and pass `resume` when a run continues.
- [ ] **Durable delegate grants:** a review turn that outlives a backend restart loses its grant.
- [ ] **eve, or another provider:** add it as an `AgentCli` plus a `ModelRunner`, with its capabilities.
- [ ] Research route for tasks classified as research.
- [ ] Slicer: split large tasks into smaller ones.
- [ ] Reconcile the hand-written code with turri output if turri becomes available again (see ADR 0002).
