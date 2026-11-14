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

- [ ] **`factory task cleanup`:** remove worktrees and branches of tasks that are pr-opened, rejected or failed.
- [ ] **Rebase or refresh a task branch** when `main` moves on, so a PR doesn't start with conflicts (see bb64645e).
- [ ] **Resume after a usage limit:** a model run that fails on "hit your limit" should leave the task resumable at the failed step (today a manual `factory task review` was needed), and could retry after the reset time.
- [ ] **Cost guardrail:** a per-task budget that stops the ladder before it climbs past a set dollar amount (bb64645e reached $5.37).

## Web app

- [ ] **Inbox:** tasks awaiting a decision across all projects, on the home page.
- [ ] **Render the approval gate's diff** with a proper code view (affect-ui `CodeBlock` / Tool Call Card patterns) instead of plain text.
- [ ] Show the task's cost and model attempts as a small breakdown.
- [ ] Replace the remaining placeholder cards with real views.
- [ ] Tests for `layer-stack.tsx` once bb64645e lands (the reviewer's nit).

## Later (plan phase 2)

- [ ] PR tending: follow review comments and CI on opened PRs.
- [ ] Research route for tasks classified as research.
- [ ] Slicer: split large tasks into smaller ones.
- [ ] Reconcile the hand-written code with turri output if turri becomes available again (see ADR 0002).
