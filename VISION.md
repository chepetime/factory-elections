# Product vision

The factory takes software work from an idea to a merged PR through AI agents. One backend controls the work. Each step has a trace with a time, tokens and a cost.

Three things define it:

- **One workflow.** An idea goes through grill, spec, board, implement, QA and tend. People approve at a few gates.
- **One control point.** Claude and Codex run side by side, and the backend owns every run.
- **One trace.** Every model call, tool call, child task and review has a span with a time, tokens and a cost.

The goal is that the trace does more than report. It is the input that routes work, sets budgets and moves gates. Thus the system gets cheaper and better over time.

Only my own work is traced. The team shows up as delivery metrics (tickets and PRs). These metrics are the baseline.

**Headline metric:** my minutes of attention per shipped outcome. Tokens are cheap. My time at gates and in review is the scarce resource.

## How it runs

The app runs locally, on one machine, in three parts:

- **Server.** The backend owns every run and holds all the data: projects, team members, features, tasks, tickets, PRs, reviews and traces.
- **Web app.** The UI for the board, the gates, the trace page and the metrics.
- **CLI.** Commands to start and drive work from the terminal.

## The vision in detail

| Document | Contents |
| --- | --- |
| [docs/vision/entities.md](docs/vision/entities.md) | The thirteen entities, how they connect, open questions |
| [docs/vision/workflow.md](docs/vision/workflow.md) | The six stages, the flow rules, the inbox, PR tending |
| [docs/vision/control.md](docs/vision/control.md) | Many agents, one control point, factory controls, tools per project |
| [docs/vision/tracing-and-metrics.md](docs/vision/tracing-and-metrics.md) | Spans, the team baseline, the metrics, the five day-one fields |
| [docs/vision/roadmap.md](docs/vision/roadmap.md) | The trace as control input, where it stands, the build order |

## Build order

The trace model comes first, because every later step reads from it. The status column is the status on 18 Nov 2026; [docs/vision/roadmap.md](docs/vision/roadmap.md) has the details.

| # | Step | Status |
| --- | --- | --- |
| 1 | One trace model | Done |
| 2 | First real paid run, first end-to-end tests | Done (scratch repo) |
| 3 | Counts across runs | Backend done; UI open |
| 4 | One inbox and PR tending | Backend done; UI open |
| 5 | Links and team import | Not started |
| 6 | Workflows, rules and controls | Not started |
| 7 | Routing, escalation and call grading | Grading done; routing not started |
| 8 | Retro and evals | Not started |
| 9 | Earned autonomy, replay and quotes | Replay inputs recorded; rest not started |
| 10 | Outcomes and upstream | Not started |
