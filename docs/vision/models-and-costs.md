# Model router, cost tracing and cost savings

Part of the [product vision](../../VISION.md). [roadmap.md](roadmap.md) has routing and escalation as control inputs. This document says how the router decides, how cost is counted, and where the savings are. [TODO.md](../../TODO.md) has the tasks.

## Where it stands

- `ProviderRouter` (`packages/core/src/agents.ts`) picks the provider from the model name only, and refuses a call that the provider cannot do safely.
- Ladders (`definitions/ladders/*.yaml`) are static. The coder climbs from Sonnet medium to Sonnet high, then Opus high, then Fable high (Fable needs human approval).
- All feature steps except the critique use one model, `FACTORY_FEATURE_MODEL` (Opus by default).
- Cost comes from the provider. Claude reports a cost. Codex reports none, so its spans have `cost_usd: null`.
- There is no price table, and the ledger does not record if a call was billed through the API or a subscription.
- Budgets are fixed: $15 per task, plus a budget per step.

## What the first paid run shows

One feature, three tickets, $8.37 in total (18 Nov 2026, scratch repo):

| Step | Model | Cost | Input tokens | Cache hit |
| --- | --- | --- | --- | --- |
| feature:spec | Opus | $2.00 | 237k | 6% |
| coder (3 tickets) | Sonnet | $1.96 | 1,087k | 58% |
| feature:qa | Opus | $1.58 | 866k | 82% |
| feature:tickets | Opus | $1.33 | 152k | 4% |
| reviewer | Sonnet | $0.72 | 322k | 48% |
| feature:critique | Sonnet | $0.63 | 146k | 6% |
| pr-writer, classifier, memory | Sonnet, Haiku | $0.15 | 85k | |

- **Planning cost more than coding.** Spec, tickets and QA on Opus were 59% of the cost. All three tickets passed the first time on Sonnet.
- **The planning steps start cold.** Each one explores the repo again in a new session, so the cache hit is about 5%.
- **QA read 866k tokens.** It explored the code again instead of reading the diff and the test results.

## The router

A route decision is a function of: the step, the task class and size, the risk, the history of that class, the provider's health and usage limits, and the budget that is left. The result is a provider, a model, an effort, a gateway and a budget.

- **Every decision is recorded** on the span: the chosen route, the reason, and the policy that chose it. Call grading can then judge the decision, not only the model.
- **Three policies, in this order:**
  1. *Pinned.* A step or task class pins a route in YAML. A pin always wins.
  2. *Learned.* From metrics, with a minimum number of runs: the cheapest route whose first-pass rate is within a margin of the best route.
  3. *Default.* The ladder's first rung.
- **A learned change to a route is a proposal first.** A model-switch item goes to the inbox with the evidence. The change applies after I approve it.
- **Try cheaper routes offline,** not on live work. Replay (step 9) reruns stored tasks of a class on the cheaper route, and the result decides. Live exploration is allowed only for low-risk classes, on a small share of runs.
- **Fallback.** When a provider is down or at its usage limit, the router moves the call to an equal route on another provider, if that provider has the capabilities the call needs. Otherwise the run waits.
- **Gateways** (OpenRouter or a custom one) are routes too. A span records the gateway.

## Cost tracing

- **Price table.** A versioned table of model prices: input, output, cache write (5 min and 1 h), cache read, and the batch discount. The backend computes the cost when a provider reports none (Codex), and checks the cost when a provider reports one.
- **Cost source** on each span: `reported`, `computed` or `unknown`.
- **Billing mode** on each span: `api` or `subscription`. A subscription call costs $0 extra but uses quota. Record its list-price cost and the quota share it used, and show both.
- **Cache writes** as their own token count. Today `tokens.input` includes them, and cache writes cost more than plain input.
- **Other costs:** paid tool APIs, CI minutes when known, and my time (attention minutes at a rate I set). The cost of an outcome is all of these.
- **Spend limits:** daily and monthly per project and in total. An inbox item opens at 80%. At 100%, new runs wait.
- **Unusual runs:** a run that costs more than the 90th percentile of its class is flagged in the inbox and in the Weekly page.
- **Reconcile:** once a month, compare the ledger with the provider's usage reports.

## Where the savings are

Ranked by the savings the paid run suggests:

1. **Right-size the planning steps.** Opus for the spec only. Tickets, QA and the critique on Sonnet, then compare the critique findings and the first-pass rate of the tickets. Expected: about $2 of the $8.37.
2. **One planning session.** Grill, spec, tickets and critique continue one session (resume or fork), so the repo exploration is read from the cache. Use the 1 h cache TTL between feature steps. Goal: above 80% cache hit.
3. **A stable prompt prefix.** System prompt, skill, facts and repo map first. Task-specific text last. Measure the cache hit per step.
4. **A shared repo map** per base SHA: files, modules, scripts and the facts. Every step reads it instead of exploring.
5. **QA from evidence.** QA reads the spec, the diff, the test results and the screenshots. It explores only what they leave open.
6. **Skip work that adds nothing.** No new review for an unchanged SHA. No browser QA for a diff with no UI change. Trivial tasks take the quick-fix workflow.
7. **Effort per step** from call grading: medium where it passes as well as high.
8. **Cheap readers.** Exploration and summaries go to child tasks on Haiku or Codex, and the parent reads the result.
9. **Batch API** (50% off) for work that can wait: retro, evals, nightly replay, memory review, upstream proposals.
10. **Short output.** Structured answers, and diffs instead of whole files.
11. **Escalation guards.** No climb on an environment failure. Stop when the loop guard finds the turn stuck twice.

## Count savings honestly

- Each lever is an experiment: a date, the change, the task classes it affects.
- Savings per class = (the baseline cost per run − the new cost per run) × runs. The baseline is the median of the 20 runs before the change.
- A saving counts only if quality holds: the first-pass rate, the review findings and the revert rate are not worse. Otherwise the experiment is rolled back.
- The Weekly page shows the savings by lever, and the cost per outcome over time.
