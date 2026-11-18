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
- [x] **Span ledger on Postgres:** the `factory_trace_events` read path has no test against a live database.
- [ ] **Tool timings for review turns:** detached turns log no tool timings. Add them with a hook, or read timestamps if the CLI adds them.
- [ ] **Store health view:** a count of spans with unknown cost, parent links that do not resolve, and ledger write errors.
- [ ] **More end-to-end flows:** the feature flow (grill to QA), the inbox and tending, against the seeded build.

## Vision step 5: links and team import

- [ ] **Run-to-ticket links:** every task run records its Jira ticket. Add the link where a task starts from a Jira issue, not only for feature tickets.
- [x] **Team member records:** name, Jira identity and GitHub identity, linked to a project.
- [ ] **Jira import:** the team's tickets per project, with type, status, assignee, and the created and resolved dates.
- [ ] **GitHub import:** the team's PRs, with author, state, opened and merged dates, review rounds and reverts.
- [ ] **PR review records** from people and from agent runs, with reviewer, verdict, findings and time taken.
- [ ] **Team baseline metrics:** lead time, review rounds and revert rate per ticket type, beside the same numbers for my agent-run work.

## Vision step 6: workflows, rules and controls

- [ ] **Per-task workflows** in YAML: full, quick fix, research and manual, chosen by task class.
- [ ] **Research workflow** for tasks classified as research.
- [ ] **Slicing rule:** each ticket is one deploy unit. The critic checks this before the board.
- [ ] **Slicer:** split large tasks into smaller ones.
- [x] **Size rule:** a PR has at most 400 non-test lines. Stop or slice when a diff is larger.
- [ ] **Inline review at the gate:** threads on the diff in the app, not only approve or revise. Record the time I spend, not only the wait.
- [ ] **Counsel step:** an agent judges each of my review comments before the coder acts on it.
- [ ] **Browser QA** for web apps, behind a proxy, from the profile's `qa_targets`.
- [ ] **Tool grants and the broker:** see [Tools](#tools) below.
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

## Tools

The design is in [docs/vision/tools-and-reviews.md](docs/vision/tools-and-reviews.md). The backend is the tool broker: agents get project tools through a backend MCP server, never credentials.

- [ ] **Tool catalog** in core: each tool has a name, a provider (GitHub, Jira, Confluence, Slack, Fathom, Figma, Sentry, New Relic, browser, local services), operations, and a level for each operation (`read`, `draft`, `publish`).
- [ ] **Grants in project settings:** the tools of a project and the highest level of each. A workflow step can narrow them. Child tasks get the grants of their parent. Keep the `tending` and `tools` fields when the settings form saves.
- [ ] **Broker MCP server:** extend the `delegate` server so that a grant token also exposes the project's tools at the step's level. Calls from another project's token fail.
- [ ] **Credential store:** the backend holds the tokens (macOS Keychain, or the storage secrets), not the agent environment. `factory doctor` and the settings page show the status and expiry of each credential.
- [ ] **Pre-run check:** a run does not start when a tool it needs is not granted or its credential has expired. An inbox item says which one.
- [ ] **Publish gate:** a `publish` write becomes an inbox item with the exact payload (comment text, ticket fields, Slack message). The write runs only after I approve it. Earned autonomy (step 9) can lift the gate per task class and tool.
- [ ] **Tool spans:** every broker call is a span with the tool, the level, an argument summary with secrets removed, the result size and the duration. Add per-tool calls, failures and latency to `GetMetrics`.
- [ ] **Untrusted content:** mark the text from PRs, tickets, Slack and web pages as untrusted in prompts. A turn that read untrusted text cannot `publish` without the gate, even with earned autonomy.
- [ ] **Remove shell access** to services that the broker covers: no `gh api`, `acli` or `curl` to those hosts from agent turns. The sandbox network rules enforce this, and the deny list stays as a second layer.
- [ ] **Read caches:** fetch PR data, the diff and CI logs once per head SHA and share them between the review, tending and QA turns. This also replaces the "prefetched PR data" option for Codex review turns.
- [ ] **GitHub tools:** read a PR, its files, diff, checks, CI logs, threads and history. Draft: a pending review with inline comments. Publish: submit a review, reply to a thread, resolve a thread.
- [ ] **Jira tools:** read an issue, its links and its epic; search with JQL. Publish: create tickets, comment, transition. Uses the project's `task_manager` settings.
- [ ] **Confluence and Fathom tools** (read) for the grill and spec steps.
- [ ] **Slack tools:** read a thread. Publish: post to the project's channel, for example "PR ready for review".
- [ ] **Figma tools** (read) for the spec and the UI QA checks, from the profile's `design_sources`.
- [ ] **Sentry and New Relic tools** (read) for the review risk check and for upstream proposals.
- [ ] **Local services tool:** start and stop the project's Docker services for one worktree, with free ports. change-elections needs this for its tests (`scripts/with-worktree-services.sh`).
- [ ] **Browser tool** for QA: open the running app behind the proxy, take screenshots, read the console. Screenshots go to the QA report and the PR.
- [ ] **Bot identity:** decide if the factory posts as my account or as a bot account. Every comment from an agent says so in a footer.
- [ ] **Fake tool adapters** for tests, and one end-to-end flow where a run uses a broker tool.

## Automated PR reviews

The flow is in [docs/vision/tools-and-reviews.md](docs/vision/tools-and-reviews.md). The factory reviews team PRs too. A review stays a draft until I approve it, and the factory never approves or merges a PR.

- [ ] **PR watcher:** read the open PRs of each project every few minutes, in the same ticker as tending.
- [ ] **Review policy per project:** which PRs get an automatic review (my review is requested, labels, paths, size, author, drafts, bots, release PRs) and a monthly budget.
- [ ] **Risk tiers:** set the review depth and budget from the diff size and risky paths (migrations, auth, payments, infra). Paths come from the project's review profile.
- [ ] **Second opinion:** high-risk PRs also get a Codex review. Disagreements go to the inbox. Needs the Codex review-turn rules (step 6).
- [ ] **Draft reviews on GitHub:** post the findings as a pending review with inline comments on the right lines. A `review` inbox item opens with each finding.
- [ ] **Edit and approve in the app:** keep, edit or remove each finding, then submit. Record the time I spend.
- [ ] **Incremental re-review:** on a new push, review only the new commits. Mark each earlier finding fixed, still open or no longer relevant.
- [ ] **Author replies:** when the author answers a finding, the agent drafts a reply for my approval.
- [ ] **Self-review before the human:** blocking findings on a factory PR go to tending as fixes before the PR reaches my inbox.
- [ ] **Do not repeat other reviewers:** skip findings that a person or another bot already left on the same lines.
- [ ] **Finding outcomes:** fixed, dismissed by me, disputed by the author, or resolved without a change. Store them per finding.
- [ ] **Misses:** issues that people raised and the agent did not, and reverts or incidents after a reviewed PR. Link them to the review.
- [ ] **Review metrics** in `GetMetrics` and the Weekly page: time to first review, cost per review by risk tier, precision, recall, my time per review, Claude and Codex agreement.
- [ ] **Learn from outcomes:** dismissed findings and misses feed the project's review profile and the facts, so the next reviews improve.
- [ ] **Review spans** for every turn, with the PR, the risk tier and the finding counts. Durable grants, so that a review that outlives a restart can still delegate.

### Review panel (specialist reviewers)

The design is in [docs/vision/tools-and-reviews.md](docs/vision/tools-and-reviews.md#a-review-panel-specialist-reviewers-under-one-lead). senior-pr-review stays the lead and the rules.

- [ ] **Benchmark set first:** about 30 merged change-elections PRs with known results (comments from people that led to a change, reverts, hotfixes). Measure the current skill on it: precision, recall, cost, wall time.
- [ ] **Context bundle per head SHA** in the backend: diff, stat, commits, ticket, CI logs, base versions of touched files, callers, history, review profile, `tests_on_base.sh` and `diff_coverage.py` results. Shared with tending and QA (the read cache in [Tools](#tools)).
- [ ] **Triage in code:** risk, size and lens triggers from the skill's path rules (§2b, §3c), with a Haiku check only for open cases.
- [x] **Reviewer definitions** in `definitions/reviewers/*.yaml`: name, lens file, trigger, model, effort, budget, tools, and which hunks it gets. The lens text stays in `definitions/skills/senior-pr-review/lenses/`.
- [ ] **Candidate schema** in core: file, lines, quoted hunk, evidence, proposed severity, confidence, specialist.
- [ ] **Specialists as child runs:** each one is traced, budgeted and takes an agent slot. The bundle is the start of each prompt, so the specialists share the cache.
- [ ] **Lead in judge mode:** a senior-pr-review mode that takes the candidates in the review context, verifies them, removes duplicates, applies the suppression lists and the cap, and writes the payload.
- [ ] **Low risk stays a single pass** on Sonnet. Move `REVIEW_MODEL` from a constant to the router.
- [ ] **New lens: data and performance** (migrations, SQL, queries, hot paths).
- [ ] **Codex as the adversarial second opinion** at High risk. Needs the Codex review-turn rules (step 6).
- [ ] **Run the benchmark on the panel** and compare it with the current skill. Switch automatic reviews to the panel only if recall is higher and precision and cost are not worse.
- [ ] **Specialist grading:** candidates that survive the lead and lead to a change, against cost, per specialist and per project. Move a weak specialist to a cheaper model or turn it off for that project.
- [ ] **Trace the skill's sub-agents** while the single-session skill stays in use: read the Agent tool calls from the turn log as child spans, not only `cost.subagents`.

## Vision step 7: model router, cost tracing and cost savings

The design and the paid-run numbers are in [docs/vision/models-and-costs.md](docs/vision/models-and-costs.md).

### Quick savings (do first)

- [ ] **Right-size the planning steps:** Opus for the spec only. Run tickets and QA on Sonnet (a model per feature step, not one `FACTORY_FEATURE_MODEL`). Compare the critique findings and the first-pass rate with the first paid run ($8.37, planning $4.91 on Opus).
- [ ] **One planning session:** grill, spec, tickets and critique continue one session (resume or fork), with the 1 h cache TTL. These steps hit the cache about 5% of the time today. Goal: above 80%.
- [ ] **Stable prompt prefix:** put the system prompt, skill, facts and repo map first and the task text last, in every step. Add the cache hit per step to `GetMetrics`.
- [ ] **QA from evidence:** QA reads the spec, the diff, the test results and the screenshots, not the whole repo again (866k input tokens in the paid run).
- [ ] **Skip repeat work:** no review for an unchanged SHA, no browser QA for a diff with no UI change.

### Router

- [ ] **Route decision type** in core: step, task class, size, risk, history, provider health, budget left → provider, model, effort, gateway, budget.
- [ ] **Record each decision** on the model span: the route, the reason and the policy (pinned, learned, default).
- [ ] **Pinned routes** in YAML per step and per task class. A pin always wins.
- [ ] **Learned routes:** the cheapest route whose first-pass rate is within a margin of the best one, after a minimum number of runs.
- [ ] **Model-switch approvals:** a learned change goes to the inbox with its evidence and applies after approval.
- [ ] **Offline tries:** test a cheaper route with replay (step 9) before it takes live work. Live tries only for low-risk classes, on a small share of runs.
- [ ] **Provider fallback:** at an outage or a usage limit, move the call to an equal route on another provider with the needed capabilities, or wait.
- [ ] **Effort per step** from call grading.
- [ ] **Budgets from history:** set each task's budget from the cost of past runs of its class.
- [ ] **Escalation rules:** the first failure of each check is free. A repeated environment failure never goes up to a stronger model. Stop when the loop guard finds a turn stuck twice.

### Cost tracing

- [ ] **Price table** (versioned): input, output, cache write (5 min and 1 h), cache read and the batch discount per model. Compute the cost of Codex calls, and check the reported Claude costs.
- [x] **`cost_source` on spans:** `reported`, `computed` or `unknown`.
- [ ] **Billing mode on spans:** `api` or `subscription`. For subscription calls, record the list-price cost and the quota share used.
- [x] **Cache writes as a token count** of their own (today `tokens.input` includes them).
- [ ] **Other costs:** paid tool APIs, CI minutes when known, and my time at a rate I set. Cost per outcome adds them all.
- [ ] **Spend limits:** daily and monthly, per project and in total. An inbox item at 80%; new runs wait at 100%.
- [x] **Unusual runs:** flag a run that costs more than the 90th percentile of its class.
- [ ] **Monthly reconcile** of the ledger with the provider's usage reports.
- [ ] **Cost on the pages:** the cost per span in the trace page, and spend by provider, model, step and billing mode in the Weekly page.

### More savings

- [ ] **Shared repo map** per base SHA (files, modules, scripts, facts) that every step reads instead of exploring.
- [ ] **Cheap readers:** exploration and summaries go to child tasks on Haiku or Codex.
- [ ] **Batch API** (50% off) for retro, evals, nightly replay, memory review and upstream proposals.
- [ ] **Tool pruning for SDK runs** too, not only for review turns.
- [ ] **Short output:** structured answers, and diffs instead of whole files.

### Count savings

- [x] **Experiments:** record each change with a date, the change and the task classes it affects.
- [ ] **Savings per class:** (median cost of the 20 runs before − cost after) × runs. A saving counts only if the first-pass rate, the review findings and the revert rate hold. Otherwise roll the change back.
- [ ] **Savings on the Weekly page:** savings by change, and the cost per outcome over time.

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
- [x] **Generated-files check:** let a profile add its own generated paths, such as `dist/` for repos that don't commit build output.
- [ ] Optionally sandbox the verification commands too. They currently run as your shell user.

## Workflow

- [ ] **LLM-generated task name:** the classifier should also return a short task name, stored on the task record and shown in the CLI and web app instead of the first line of the prompt or the UUID.
- [ ] **`factory task cleanup`:** remove worktrees and branches of tasks that are pr-opened, rejected or failed.
- [ ] **Rebase or refresh a task branch** when `main` moves on, so a PR doesn't start with conflicts (see bb64645e).
- [ ] **Resume a model step after a restart:** steps return a session id now; keep sessions (`persistSession`) and pass `resume` when a run continues.
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
