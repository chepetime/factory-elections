# factory-elections

My own software factory, tailored to my needs. It starts from the ideas in the sibling repo [`devin-factory`](/Users/jlugo/Projects/personal/devin-factory) and keeps only the parts I want.

## Plan

1. Use `devin-factory` as the reference. Do not fork it as-is.
2. Describe what `devin-factory` does (below).
3. Make a feature inventory of `devin-factory` (below). Mark each feature **Keep**, **Change** or **Drop**.
4. Build the "Keep" and "Change" features here, smallest useful loop first.

## What devin-factory does

`devin-factory` is a personal software factory. It takes a plain-language prompt and a target repo, and it gives back a reviewed pull request. A Node **driver** runs a fixed set of model **steps** on the Claude Agent SDK (and Codex for some coder rungs). The steps classify, build, review and ship the change. The human stays in control: nothing becomes a PR until the human looks at the diff and says yes.

A task moves through these stages:

1. **Intake.** A prompt becomes a task. Sources: the app's New task form, `bin/factory-run`, or the mirror hook in interactive Claude Code sessions. Each task gets a directory and a `task.json` in the data root (`~/.local/share/factory/`).
2. **Queue.** The dispatcher service starts queued tasks during opening hours (weekdays, 09:00–17:00). It pauses them at closing time. Overtime, Stop and Halt change this.
3. **Classify.** The classifier states facts: size (LOE), readiness, kind, shape and risk signals. The driver maps those facts to a route and a starting model rung with `config/policy.json`. The classifier never picks the route.
4. **Clarify (gate 1).** If the task is not clear, it stops and asks the human before any code.
5. **Build.** The coder writes code and tests in a dedicated worktree and branch. The driver runs the repo's checks and commits. The reviewer reads the diff against the brief. Failures climb a model ladder. A task too big for one PR goes to the slicer. The human approves the slices (gate 2).
6. **Review gate.** The app shows the diff, the reviewer's findings and open decisions. The human answers, asks for changes, or opens the PR.
7. **PR and tending.** The author step writes the PR body. The driver pushes and opens the PR. The tender step then watches the PR and fixes review threads, failing CI and merge conflicts.

Research tasks take a short path: the researcher answers and writes a research file, with no branch.

Around this core loop, the factory records every run, cost and decision. It reviews its own runs (retro, row review, grading) and proposes changes to its own policy.

## Feature inventory

Source: `devin-factory` at commit `38f7e12b` (2026-11-13), about 160 ADRs. The latest ADRs (0162–0164) retire the Work Hub, make the task the one record, and move loops and agents to YAML definitions. Those changes are in progress there.

Decision column: **K** = keep, **C** = change, **D** = drop, **?** = undecided. The values are recommendations, open for change. Phases are in [Tailoring](#tailoring).

### 1. Intake and task records

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Task directory + `task.json` | One directory per task, with stage, answers, timeline | data root `<project>/tasks/<intake-id>/` | K |
| `factory-run` CLI | Start a task from the shell | `bin/factory-run` | K |
| New task form | Start a task from the app | `app/` | K (phase 3) |
| Mirror hook | Records plain-prompt tasks from interactive Claude Code sessions (SessionStart hook) | `hooks/hooks.json`, `bin/factory-mirror-hook` | D (hub retired) |
| Side entrance | Other queue sources, for example a mobile session that leaves a prompt | ADR 0022 | D (later) |
| Intake brief | Normalized brief for the classifier, whatever the source | `lib/` | K |
| Intent step + why-probe | Checks intent. Asks "why" when the brief does not say | `steps/intent.md` | K |
| Task export | Export a task's record | `bin/factory-task-export` | D (later) |
| Start over / rerun with instructions | Restart a task fresh, or rerun it with a note that wins over the brief | app, Send | K |

### 2. Classification and routing

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Classifier step | States size, readiness, kind, shape, signals. Never picks route | `steps/classifier.md` | K |
| Policy table | Maps facts to route and starting model rung | `config/policy.json` | C: YAML, split by reader (ADR 0164) |
| Bump signals | `root_cause_unknown`, `shared_surface`, `new_pattern`, `data_or_migration` raise the starting rung | `policy.json#bump` | K |
| Gate 1 (clarification) | Stops unclear tasks before any code | ADR 0003 | K |
| PR budget + tripwire | Coder stops with `needs-slicing` when the diff passes the line budget | `bin/factory-diff-budget`, ADR 0006 | K |

### 3. Build loop (steps and driver)

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Driver state machine | Counts failures, runs checks, commits, writes task file, enforces gates | `lib/driver*.mjs` | C: pure core + adapters, loops as data |
| `runStep` | Runs one step via the Agent SDK, with permissions from the repo profile | `lib/run-step.mjs` | C: behind a model-runner interface |
| Coder | Writes code and tests in the task's worktree | `steps/coder.md` | K |
| Reviewer | Reads the diff against the brief, returns findings | `steps/reviewer.md` | K |
| Model ladder | On failure, climb rungs: Codex (sol) → Sonnet medium → Sonnet high → Opus medium → Opus high | `policy.json#coder_codex` | C: Claude only (Sonnet med → Sonnet high → Opus med → Opus high) |
| Codex rounds | Delegate a coder round to Codex, guarded by a before/after snapshot | `bin/factory-codex-round`, `bin/factory-round-check` | D (add later as an adapter) |
| Break-glass (Fable) | One-task human yes to run Fable, only after Opus fails or at the critic offer | ADR 0008 | C: top ladder rung, needs human yes |
| Full check | Runs the repo's full test suite, one at a time across the factory | `policy.json#full_check` | K |
| Stall watchdog | Aborts a step with no progress, records `stalled`, does not count as failure | `policy.json#stall` | K |
| Worktree per task | Own branch and worktree per task | `bin/factory-worktree-new` | K |

### 4. Large work: efforts, slicing, planning

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Slicer | Splits a big task into PR-sized slices | `steps/slicer.md` | K (phase 2) |
| Gate 2 | Human approves the slicer's proposal | ADR 0018 | K (phase 2) |
| Critic + critic gate | Critiques big or risky slice plans (≥4 slices, deep chains, migrations) | `steps/critic.md`, `lib/critic-gate.mjs` | C: phase 2, simpler trigger rules |
| Deploy guard / waits-for | Holds a consumer slice until the human confirms its producer is live | ADR 0018 | K (phase 2, Elections has several deploy units) |
| Wayfinder | Plans an effort: charts a map, grills the human one ticket at a time, writes a spec | `steps/wayfinder.md`, ADR 0091 | D (later) |
| Efforts and maps | Planning record with decisions and open questions | app effort page | D (later) |

### 5. QA

| Feature | What it does | Where | Decision |
|---|---|---|---|
| QA step | Drives the app (Playwright MCP) to test the change | `steps/qa.md` | C: phase 4, drive Elections apps via chrome-devtools MCP |
| QA gate | Decides run/skip (skips docs-, config- and test-only diffs), logs every skip | ADR 0027 | K (phase 4) |
| Monkey loop | Bounded exploratory clicking inside a QA target | `policy.json#qa.monkey` | D |
| QA targets | Per-repo targets that QA may touch | repo profile | K (phase 4) |

### 6. Review gate and PR

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Review gate | Human reviews diff, findings, decisions in the app | `app/src/app/tasks/[id]/review` | K |
| Author step | Writes the PR body | `steps/author.md` | K |
| Open PR | Pushes branch, opens PR. Merges a moved base first and returns to the gate | ADR 0156 | K |
| Screenshots | Attach human-submitted screenshots; steps can see them | `bin/factory-github-attach`, ADR 0160 | C: QA screenshots only, phase 4 |
| Tender | Tends open PRs: review threads, failing CI, conflicts. Fixes go through coder | `steps/tender.md`, `bin/factory-tender` | K (phase 2) |
| PR sweep | Dispatcher queues tender runs for PRs that need attention | ADR 0121 | K (phase 2) |
| Merged-PR resolver | Detects merged PRs and closes tasks | dispatcher | K (phase 2) |

### 7. Research

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Researcher step | Answers a question, writes a research file. No branch | `steps/researcher.md` | K (phase 2) |
| Research pass for unknown size | Tasks of unknown LOE get research first | `policy.json#coder_starting_rung.unknown` | K (phase 2) |
| Second pass on blockers | An open research blocker gets a second pass before it goes to the human | ADR 0161 | K (phase 2) |

### 8. Scheduling and control

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Dispatcher | Long-running scheduler: global concurrency 2, one task per repo | `lib/dispatcher*.mjs`, `bin/factory-dispatcher` | C: phase 4, simple queue, concurrency in config |
| Opening hours | Works weekdays 09:00–17:00 only, pauses at closing, grace window | `policy.json#dispatcher` | D (run on demand) |
| Overtime | Keeps the factory open outside opening hours | `bin/factory-mode` | D |
| Stop | Graceful: sessions pause at the next safe point | `bin/factory-stop` | K |
| Halt | Hard abort of all sessions | `bin/factory-halt` | K |
| Stop task / steering | Per-task stop, and unprompted human direction shown on the timeline | app, Send | K |
| Self-update | Pull main and reload services without losing work | `pnpm factory:update` | D (later) |
| LaunchAgents | Dispatcher and app run as macOS user services | `config/*.plist`, `scripts/install-services` | C: phase 4, with the dispatcher |

### 9. Factory app (Next.js, localhost:4317)

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Inbox | Decisions waiting on the human, one card at a time | `app/src/app/inbox` | K (phase 3) |
| Pipeline / task table | All tasks and stages in one table | `app/src/app/page.tsx` | K (phase 3) |
| Task page + timeline | Task detail, events, step activity, hub ticket | `app/src/app/tasks/[id]` | K (phase 3) |
| Projects and efforts | Per-project views, effort pages, ticket triage | `app/src/app/projects` | C: projects only (phase 3) |
| Weekly view | Cost and outcomes per week. Codex cost shown as an estimate | `app/src/app/weekly` | C: cost and outcomes only (phase 5) |
| Settings | Gateways (plan, OpenRouter, custom), profile edit, other settings | `app/src/app/settings` | C: fewer options (phase 3) |
| Ask panel | Ask read-only questions about the open page. Suggestions become tasks | `steps/ask.md`, `bin/factory-ask` | D (later) |
| Send templates | Fixed set of actions the app can take. App holds no state | `app/` | K: app is a thin client over one command API |
| Preview mode | Seeded throwaway data root with Send stubbed out | `scripts/preview-app.mjs` | K (phase 3) |

### 10. Repo profiles

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Repo profile | Per-repo checks, worktree/env setup, safety lists, pinned docs | `<data root>/<project>/profile.yaml` | K |
| `profile-draft` skill | Drafts a profile from repo evidence, asks safety checklist, human approves | `skills/profile-draft` | K |
| Drift check | Every run checks the profile for drift before it starts | `bin/factory-profile` | K |
| Deny rules / step permissions | Tool permissions per step from the profile | `lib/` | K |

### 11. Telemetry, grading and self-improvement

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Run records | Per-run record of steps, cost, outcome | data root | K |
| Telemetry store | Rebuildable SQLite cache: runs, stalls, verdicts, calls, outcomes, gaps | `bin/factory-store` | C: phase 5, rebuilt from run records |
| Gaps | Missing values shown as "—", never as zero | ADR 0020 | K |
| Grading | Grades policy rows from telemetry | `bin/factory-grade` | D (later) |
| Row review | Reviews a policy row; returns keep/change with proposals | `steps/row-review.md` | D (later) |
| Retro | Reviews every finished run, flags outliers (spend > 2× median), proposes changes | `steps/retro.md`, `bin/factory-retro` | C: phase 5, simpler |
| Counsel | Second-opinion review step | `steps/counsel.md` | D |
| Overtime summary | Summarizes work done in overtime | `steps/overtime.md` | D |
| Classifier and intent evals | Eval cases built from past PRs, tuning/holdout split | `bin/factory-eval`, `policy.json#evals` | C: phase 5; build classifier fixtures from day 1 |

### 12. Upkeep and housekeeping

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Overnight pass | Daily 03:00 local script, no model call: housekeeping sync and upkeep report | `bin/factory-overnight-pass` | D |
| Housekeeping | Prunes worktrees older than 7 days, retention, archives | `bin/factory-housekeeping` | C: one CLI command (worktree prune) |
| Upkeep skill + agent | Session-start report of pending questions and next work (Haiku agent) | `skills/upkeep`, `agents/upkeep.md` | D |
| Archives | Task and effort archives, done-effort check | `lib/` | C: archive finished tasks only |

### 13. Work Hub and trackers (being retired upstream)

| Feature | What it does | Where | Decision |
|---|---|---|---|
| Work Hub | Efforts and items. Local JSON files, or GitHub issues for the factory itself | `bin/factory-hub` | D (retired upstream) |
| Mirror skill | One-way copy of task files to the hub | `skills/mirror`, `bin/factory-mirror` | D |
| Tracker + denylist | Reads external trackers, with a denylist | `bin/factory-tracker`, `config/tracker-denylist.json` | C: optional Jira intake adapter later |

### 14. Engineering practices

| Feature | What it does | Where | Decision |
|---|---|---|---|
| ADRs | One decision per record, about 160 records | `docs/adr/` | K |
| Glossary | Shared terms for code, docs and commits | `CONTEXT.md` | K |
| Coding standards | What a review checks | `CODING_STANDARDS.md` | K |
| Tests | `node --test` unit tests plus e2e flows, changed-only runners | `test/`, `scripts/test-changed.mjs` | K: tests per package |
| Tooling | pnpm only, Node ≥ 26, oxlint with warnings denied | `package.json` | C: add TypeScript strict |

## Tailoring

Recommended defaults. Change any of them.

- **Target repos.** The Elections monorepo first, then this repo itself.
- **Models.** Claude only, on my plan. Haiku for cheap steps (classifier), Sonnet for coder and reviewer, Opus for ladder climbs. Fable only with a human yes. No Codex in v1.
- **Hours.** Run on demand. No opening hours or overtime.
- **Concurrency.** One task at a time in v1. Raise it later in config.
- **Budget.** Record the cost of every run. Flag a run that costs more than 2× the median. No hard cap in v1.
- **Language.** TypeScript (strict), ESM, pnpm workspaces, Node ≥ 26.
- **Phases.**
  1. CLI loop: intake → classify → coder → reviewer → human review gate → open PR, for one repo profile.
  2. Tender, research route, slicer with gate 2 and critic.
  3. Web app: inbox, task table, task page, review gate, settings.
  4. Dispatcher queue, LaunchAgents, QA step.
  5. Telemetry store, weekly view, retro, evals.

## Next steps

- [ ] Confirm or change the Decision column and Tailoring.
- [ ] Give [docs/migration-prompt.md](/Users/jlugo/Projects/personal/factory-elections/docs/migration-prompt.md) to the LLM that builds phase 1.
