# TODO

The tasks that remain to fulfill the [product vision](VISION.md), grouped by build step, then the other follow-ups. The README lists what works today. [docs/vision/roadmap.md](docs/vision/roadmap.md) has the status of each step, and [docs/HANDOFF.md](docs/HANDOFF.md) has the background.

## Now

- [ ] **Decide task bb64645e** (LayerStack component on the web homepage). It is at the approval gate at `5750b1ee1546`, with verification passed and the review approved with 3 minor findings. Check the animation in a browser, then approve and open the PR, revise it or reject it. Its branch predates the affect-ui commit on `main`, so expect a conflict, mostly in `pnpm-lock.yaml`.
- [ ] **Use the new components in the web app:** `AgentFindings` for review findings and `AgentCheckpoints` for the stage timeline on the task page. Wait until the component work in the other session settles.
- [ ] **First paid run on a real project:** take one change-elections feature end to end (the profile is approved). Do not mirror to Jira or open a PR until the run is checked.
- [ ] **Answer the open entity questions** in [docs/vision/entities.md](docs/vision/entities.md): ticket vs task, feature vs epic, human PR reviews, a team above members. Steps 5 and 6 depend on them.

## Vision steps 1–4: finish what is open

- [ ] **Trace page (UI agent):** one run as a span tree from `GetTrace`, with the time, tokens and cost of each span and the totals per subtree.
- [ ] **Weekly page (UI agent):** spend and tokens per day, cost and median time per PR, the reliability rates and call grading, from `GetMetrics`.
- [ ] **Inbox page (UI agent):** one list from `GetInbox` across all projects, on the home page, with `DismissInboxItem`. This replaces the per-page lists.
- [ ] **Tending toggle (UI agent)** in project settings. The settings form must keep the `tending` field, or a save turns tending off.
- [ ] **Feature gate screens (UI agent):** approve the spec and the board in the browser, not only through the RPCs.
- [ ] **Tending gaps:** a stale `pr-opened` worktree that was removed stops tending with an error. Thread replies post as the signed-in `gh` account.
- [ ] **Span ledger on Postgres:** the `factory_trace_events` read path has no test against a live database.
- [ ] **Tool timings for review turns:** detached turns log no tool timings. Add them with a hook, or read timestamps if the CLI adds them.
- [ ] **Store health view:** a count of spans with unknown cost, parent links that do not resolve, and ledger write errors.
- [ ] **Cheaper planning steps:** the first paid run spent $5.54 of $8.37 on Opus planning steps. Try Sonnet or medium effort for the ticket and QA steps, and compare the results.
- [ ] **More end-to-end flows:** the feature flow (grill to QA), the inbox and tending, against the seeded build.

## Vision step 5: links and team import

- [ ] **Run-to-ticket links:** every task run records its Jira ticket. Add the link where a task starts from a Jira issue, not only for feature tickets.
- [ ] **Team member records:** name, Jira identity and GitHub identity, linked to a project.
- [ ] **Jira import:** the team's tickets per project, with type, status, assignee, and the created and resolved dates.
- [ ] **GitHub import:** the team's PRs, with author, state, opened and merged dates, review rounds and reverts.
- [ ] **PR review records** from people and from agent runs, with reviewer, verdict, findings and time taken.
- [ ] **Team baseline metrics:** lead time, review rounds and revert rate per ticket type, beside the same numbers for my agent-run work.

## Vision step 6: workflows, rules and controls

- [ ] **Per-task workflows** in YAML: full, quick fix, research and manual, chosen by task class.
- [ ] **Research workflow** for tasks classified as research.
- [ ] **Slicing rule:** each ticket is one deploy unit. The critic checks this before the board.
- [ ] **Slicer:** split large tasks into smaller ones.
- [ ] **Size rule:** a PR has at most 400 non-test lines. Stop or slice when a diff is larger.
- [ ] **Inline review at the gate:** threads on the diff in the app, not only approve or revise. Record the time I spend, not only the wait.
- [ ] **Counsel step:** an agent judges each of my review comments before the coder acts on it.
- [ ] **Browser QA** for web apps, behind a proxy, from the profile's `qa_targets`.
- [ ] **Tool grants per project:** declare tools (for example Jira, Slack and Fathom for Elections) with an access level in the project settings. The backend holds the credentials and grants a run only its project's tools. Child tasks get the same set. A workflow step can narrow it.
- [ ] **Tool pre-check:** a run does not start when a needed tool is not granted or its credential has expired. An item goes to the inbox.
- [ ] **Gateways:** OpenRouter and custom gateways. Each run records its gateway, and metrics split spend by it.
- [ ] **Pi** as a third agent beside Claude and Codex.
- [ ] **Another provider (eve or similar):** add it as an `AgentCli` plus a `ModelRunner`, with its capabilities.
- [ ] **Codex review turns:** they need deny rules that hold for wrapped commands. Options: a Codex rules file plus no network, or prefetched PR data.
- [ ] **Loop guard and context warnings for review turns and Codex:** they need tool hooks (a `--settings` hook command for detached Claude turns).
- [ ] **Opening hours,** with overtime that needs a reason.
- [ ] **Stop and Halt:** Stop lets runs finish, Halt ends them now.
- [ ] **Limits per repo and per effort level.**
- [ ] **Dead-run check:** find runs whose process died and recover or fail them.
- [ ] **Usage-limit skip:** skip a provider until its usage limit resets, and retry the task automatically at the reset time.

## Vision step 7: routing, escalation and call grading

- [ ] **Routing:** pick the provider and model for each task class from observed cost, first-pass rate and call grading.
- [ ] **Budgets from history:** set each task's budget from the cost of past runs of its class.
- [ ] **Escalation rules:** the first failure of each check is free, and a repeated environment failure never goes up to a stronger model.
- [ ] **Model-switch approvals** in the inbox when routing wants to change a pinned model.

## Vision step 8: retro and evals

- [ ] **Daily retro:** read finished runs and propose fixes. Proposals go to the inbox to accept or reject.
- [ ] **Evals** for the classifier and the routing steps.
- [ ] **Nightly model-pin check.**

## Vision step 9: earned autonomy, replay and quotes

- [ ] **Replay:** rerun a stored task (repo state, prompt, verification from its run span) on a new model, and compare the result with the original.
- [ ] **Quotes:** at spec time, predict cost, time and the chance to pass the first time. Flag a run that moves away from its quote.
- [ ] **Earned autonomy:** a task class with a long series of clean passes loses its approval gate. One revert brings it back.

## Vision step 10: outcomes and upstream

- [ ] **Outcome records:** merged, reverted and incident records that join spans on `task_id` and `pr`.
- [ ] **Cost per outcome:** count cost per shipped outcome, not per PR. Add the attention metric (my minutes per shipped outcome).
- [ ] **Product metric link:** record if a feature moved its product metric.
- [ ] **Upstream proposals:** read the backlog, incidents and review findings, then draft specs for me to accept or reject.

## Safety

- [ ] **Coder sandbox, next steps:** deny reads of secrets (`~/.ssh`, `~/.npmrc`, `~/.aws`, `~/.config/gh`, keychains) using `filesystem.denyRead` / `credentials`.
- [ ] **Per-profile sandbox settings:** extra allowed hosts (other registries, `git fetch`) and write paths, declared in the repo profile rather than hard-coded in `sandboxFor`.
- [ ] **Generated-files check:** let a profile add its own generated paths, such as `dist/` for repos that don't commit build output.
- [ ] Optionally sandbox the verification commands too. They currently run as your shell user.

## Workflow

- [ ] **LLM-generated task name:** the classifier should also return a short task name, stored on the task record and shown in the CLI and web app instead of the first line of the prompt or the UUID.
- [ ] **`factory task cleanup`:** remove worktrees and branches of tasks that are pr-opened, rejected or failed.
- [ ] **Rebase or refresh a task branch** when `main` moves on, so a PR doesn't start with conflicts (see bb64645e).
- [ ] **Resume a model step after a restart:** steps return a session id now; keep sessions (`persistSession`) and pass `resume` when a run continues.
- [ ] **Durable delegate grants:** a review turn that outlives a backend restart loses its grant.
- [x] **Resume after a usage limit:** a usage-limit failure says to run the task again after the reset, and `run` continues at the reviewer when verification already passed.
- [x] **Cost guardrail:** `limits.task_budget_usd` in the profile (default $15) stops the ladder before the next model call; each call also gets its step's `budget_usd`.

## Web app

- [ ] **Chat-style task view:** show the task as a conversation (prompt, coder and reviewer turns, revise notes, approval) with a toggleable sidebar listing all task events.
- [ ] **Use the new components across the app:** the affect-ui free components (`packages/affect-ui`) and shadcn/ui, following [docs/frontend-component-patterns.md](docs/frontend-component-patterns.md), instead of hand-rolled markup.
- [ ] **Render the approval gate's diff** with a proper code view (affect-ui `CodeBlock` / Tool Call Card patterns) instead of plain text.
- [ ] Show the task's cost and model attempts as a small breakdown.
- [ ] Replace the remaining placeholder cards with real views.
- [ ] Tests for `layer-stack.tsx` once bb64645e lands (the reviewer's nit).

## Other

- [ ] Reconcile the hand-written code with turri output if turri becomes available again (see ADR 0002).
