# Roadmap

Part of the [product vision](../../VISION.md).

## The trace as control input

The trace feeds decisions back into the system. Thus the system improves without anyone reading a chart.

1. **Routing.** The backend picks the provider and model for each task type from observed cost, first-pass rate and call grading. It sets budgets from history.
2. **Escalation.** A task goes up to a stronger model when checks keep failing or the loop guard fires. The first failure of each check is free. A repeated environment failure never goes up.
3. **Retro.** A daily retro reads finished runs and proposes fixes. Proposals go to the inbox for me to accept or reject.
4. **Evals.** Evals check the steps that classify and route work. A nightly pass checks the model pins.
5. **Replay.** Every finished task is stored as a replayable case: repo state, spec and verification. A new model is judged by a rerun of my own history. This removes the bias of harder tasks going to stronger models.
6. **Quotes.** At spec time the app predicts cost, time and the chance to pass the first time. A run that moves away from its quote is flagged early.
7. **Earned autonomy.** Gates move with the track record. A task class with a long series of clean passes loses its approval gate. One revert brings the gate back.
8. **Outcomes.** Work is followed after merge, so cost is counted per outcome and not per PR.
9. **Upstream.** The app proposes work. It reads the backlog, incidents and review findings, then writes draft specs for me to accept or reject.

## Where it stands

The main gaps are not more agents. They are one trace model across everything, and links from runs to tickets and PRs, so that the metrics can be counted.

Status on 18 Nov 2026:

| Area | Built | Missing |
| --- | --- | --- |
| Workflow | The workflow and its RPCs. One paid run end to end on a scratch repo | A UI for the feature gates, per-task workflows, size and slicing rules, browser QA |
| PR tending | The tending loop (opt-in per project): merge-base, thread answers, reruns, CI fixes | The settings toggle in the UI |
| Inbox | One inbox with one rule (`GetInbox`) | The Inbox page |
| Human review | A gate that approves or asks for a revision | Inline threads on the diff, the counsel step |
| Agents and control | Slots, budgets, git locks, recovery, provider rules | Tool grants per project, gateways and Pi, opening hours, Stop and Halt, limits per repo and effort, a dead-run check |
| Tracing | The span ledger: model, tool, child, review, memory-review, loop-judge, gate and PR spans, with tokens and costs | The trace page, the time I spend at gates (only the wait is recorded) |
| Team delivery | Team members and assignments | The Jira and GitHub import of team metrics |
| Metrics | Counts across runs and call grading (`GetMetrics`) | The Weekly page |
| Learning loop | Repository facts | Retro, evals, routing, quotes, earned autonomy |
| Tests | Unit tests, end-to-end flows against a seeded build (`pnpm e2e`) | |

## Build order

The trace model comes first, because every later step reads from it. This order is a proposal.

1. **One trace model.** Add tool-call spans, tokens on spans, and reviews and children in the trace tree. Include the five day-one fields. *Done.*
2. **First real paid run.** Take one feature end to end through the workflow, with the minimum UI to approve at the gates and the project's tools granted. Add the first end-to-end tests against a seeded build. *Done on a scratch repo; the feature gate UI and tool grants are open.*
3. **Counts across runs.** Build the store views, the Weekly page and the trace page. *Backend done; pages open.*
4. **One inbox and PR tending.** Put everything that waits on me in one place, and keep open PRs moving until they merge. *Backend done; pages open.*
5. **Links and team import.** Link runs to Jira tickets and PRs, and import team tickets and PRs from Jira and GitHub. *Spans carry the ticket and PR; the import is open.*
6. **Workflows, rules and controls.** Add per-task workflows, the size and slicing rules, inline review with counsel, browser QA, gateways and Pi, and the factory controls.
7. **Routing, escalation and call grading.** Use the metrics to pick models, set budgets and decide when a task goes up. *Call grading done.* [models-and-costs.md](models-and-costs.md) has the design.
8. **Retro and evals.** Propose fixes from finished runs, and check the steps that classify and route.
9. **Earned autonomy, replay and quotes.** Move gates with the track record, rerun stored tasks on new models, and predict cost and time at spec time. *Run spans record the replay inputs.*
10. **Outcomes and upstream.** Follow work after merge, and let the app propose specs.

[TODO.md](../../TODO.md) has the open follow-ups.
