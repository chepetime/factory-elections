# How work flows

Part of the [product vision](../../VISION.md).

Work comes in as features and tasks. Each one follows the same six stages:

1. **Grill.** The idea is questioned until its scope and intent are clear.
2. **Spec.** The idea becomes a written spec.
3. **Board.** The spec is split into tickets. Each ticket is tied to Jira.
4. **Implement.** Agents build the tickets, in parallel.
5. **QA.** The result is verified before it becomes a PR. Web apps also get a browser QA step, behind a proxy.
6. **Tend.** The open PR is looked after until it merges.

People approve at a few gates on the way. Each ticket stays linked to its Jira issue and its PR.

## Rules

Four rules shape the flow:

- **Workflows.** Each task runs one of a few workflows: full, quick fix, research or manual. Workflows are defined in YAML and chosen by task class.
- **Slicing.** Each ticket is one deploy unit. A critic reviews the slicing before it reaches the board.
- **Size.** A PR has at most 400 non-test lines.
- **Review.** At a gate I review the diff in the app with inline threads, not only approve or revise. A counsel step then judges each of my comments before agents act on it.

## One inbox

One rule decides what waits on me: the next step needs a human decision and no agent works on it. Everything that waits lands in one inbox:

- Gate approvals and reviews
- Questions from agents
- Guesses that block a PR
- Findings
- Retro proposals
- Model-switch approvals

Everything else continues without me. The time each item waits and the time I spend on it feed the attention metric.

## PR tending

Tending runs every 10 minutes on my open PRs. It:

- answers review threads,
- fixes failing CI,
- merges in the base branch when the PR has a conflict,
- reruns flaky jobs.

It never force-pushes and never merges the PR.

[docs/local-backend.md](../local-backend.md) describes how the backend runs the inbox and tending today.
