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

A Weekly page shows the numbers I check most: spend and tokens per day, cost and median time per PR, the reliability rates and call grading.

## What the trace model must capture from day one

Five fields are cheap to record now and difficult to add later:

- A task class on every run, so runs of the same kind can be compared and routed.
- The inputs needed to replay a run: repo state, spec and verification.
- Spans for my own time at gates and in review.
- A link from each run to its Jira ticket and PR.
- A link from each run to its outcome: merged, reverted, incident.
