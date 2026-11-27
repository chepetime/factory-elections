# Everything traced and costed

Part of the [product vision](../../VISION.md).

Every unit of work has a span with a time, tokens and a cost, in one trace tree per run. The span types are:

- Model call
- Tool call
- Child task
- Review
- Memory review
- Loop-guard judgement
- My own time at gates and in review

Costs roll up from span to task, feature and project. A trace page shows where time and money go for any run, down to a single call.

Spans are also appended to a plain log, so the metrics store can be rebuilt from it at any time. The store has views that count across runs: runs, stalls, repeat loops and store health.

[docs/local-backend.md](../local-backend.md) ("The span ledger") describes the ledger as built.

## Set against team delivery

Only my work is traced. The team shows up as delivery metrics from Jira and GitHub, with no agent traces and no cost.

| | My work | The team |
| --- | --- | --- |
| Source | Agent runs in the app | Jira and GitHub |
| Recorded | Spans, tokens, cost, gates, my review time | Tickets, PRs, lead time, review time, reverts |
| Rolls up by | Task, feature and project | Project |
| Used for | Seeing where time and money go | The baseline that my agent-run work is compared against |

My runs link to their Jira ticket and PR. The same ticket types go through both paths, so lead time, review rounds and revert rate can be compared directly.

## Metrics

The headline metric is my minutes of attention per shipped outcome. Tokens are cheap. My time at gates and in review is the scarce resource.

| Group | Metrics |
| --- | --- |
| Attention | My minutes per shipped outcome, time spent at each gate, review time, inbox wait time |
| Cost | Per task, per feature and per merged PR. Spend and tokens per day |
| Speed | Lead time from idea to PR and to merge, median time per PR, time waiting at each gate |
| Quality | First-pass verification rate, review findings, Reticle verdicts, reverts |
| Reliability | Failure rate, stalls, repeat loops, and climb rate (how often a task goes up to a stronger model) |
| Call grading | Whether the first model picked for each workflow and task size was the right one |
| Outcome | What happens after merge: reverts, incidents, whether the feature moved its product metric |
| Agent use | Agent hours, cache-hit rate, context used, how often the loop guard steps in, what the facts have saved |
| Comparison | Providers and models on the same kind of work, and my agent-run work against the team baseline |

### Waste signals

`runSignals(spans)` (`packages/core/src/run-signals.ts`) finds where a run spent money for nothing. It reads the span ledger only: no model judge, no second copy of span data, $0 per run. `metricsSummary` adds `runs.waste` (the 10 runs with the most wasted dollars) and `runs.clean_rate` (the share of runs with category `fine`).

| Signal | Meaning |
| --- | --- |
| `edit_churn` | The most edits of one path. From 5 edits of a path, the edits after the first count as waste |
| `repeated_calls` | Calls beyond the first of an identical tool name and normalized input made 3 or more times. Hashes, paths and numbers are blanked (ADR 0106) |
| `oscillations` | A/B/A/B runs of two different calls (not checks, not observations) |
| `fail_fix_loops` | A check command from `replay.verification` fails, a file is edited, the same check fails again |
| `max_failure_streak` | The most failed tool calls in a row. From the third on, calls count as waste |
| `empty_answers` | Coder calls that finished with a final message of 0 characters (`final_chars` on the model span) |
| `wasted_calls`, `waste_ratio` | Distinct wasted calls, and their share of the run's tool calls |
| `wasted_usd`, `wasted_tokens` | Run cost, and run input plus output tokens, times `waste_ratio` |
| `category` | `thrash` (churn, repeats, oscillation or a fail-fix loop), else `errors` (a streak of 3, an empty answer, or half the calls failed), else `failed` (the run did not complete), else `fine` |

Observations (`Read`, `Grep`, `Glob`, `ls`, `cat`, `git status`, `git log`, log and status reads, screenshots) are exempt from repeats and oscillation, because looking again is cheap and often right. Edits are judged by churn, not repeats.

Limits:

- A tool span keeps the tool name, the first 200 characters of its command or path, and the outcome. It has no output, so the signals see the shape of the calls, not whether a repeat was needed. A repeated build that was right to repeat still counts.
- Blanking paths and numbers makes `pnpm test a.test.ts` and `pnpm test b.test.ts` the same call. Three different test files run in turn count as a repeat.
- Waste is priced as run cost times `waste_ratio`. Every call is treated as costing the same share, so it is a rank, not an invoice.
- Codex reports no cost. Its runs have `wasted_usd: null`, never $0, and rank after runs with a known cost, by `wasted_tokens`. A run with any span of unknown cost is unknown.
- Fail-fix loops need the verification commands of the run span. A trace with none has no loops. A check run inside a longer shell line matches when the line contains the command.
- Model spans keep `final_chars`, the length of the final message, and no text. Nothing else about the answer can be told from the ledger.

A Weekly page shows the numbers I check most: spend and tokens per day, cost and median time per PR, the reliability rates and call grading.

## What the trace model must capture from day one

Five fields are cheap to record now and difficult to add later:

- A task class on every run, so runs of the same kind can be compared and routed.
- The inputs needed to replay a run: repo state, spec and verification.
- Spans for my own time at gates and in review.
- A link from each run to its Jira ticket and PR.
- A link from each run to its outcome: merged, reverted, incident.
