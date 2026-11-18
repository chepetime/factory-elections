> **Factory copy.** Adapted from `~/.claude/skills/senior-pr-review` (commit b83d0df, v4.0.3). The backend appends `SKILL.md` to the system prompt of each PR review chat. Changes: the review saves a JSON payload that the app shows as its Report screen, instead of rendering HTML. The renderer, A/B harness and evals are not copied. Review profiles in `profiles/` are defaults; a project setting can replace them.

# senior-pr-review

A Claude Code skill that reviews a branch or pull request the way a senior engineer does. Rigor scales with risk, and every blocking finding rests on evidence the review produced itself, not on the PR author's narrative. It writes an executive HTML report the reviewer can decide from in under a minute.

The report shows, in this order: risk, size and verdict; the problem restated from the original signal, with any mismatch against the PR description; problem fit and proof (tests run against base, diff coverage, CI logs); blocking findings with evidence; non-blocking suggestions; what was not verified and a confidence level; the post-merge signal to check; residual risks; cost and details. A `comments.json` sidecar beside it holds each finding as a postable PR comment.

Verdicts: Approve, Comment, Request changes, Needs discussion, Needs attention (the approach goes against project rules or direction). The chat reply ends with numbered posting options for that verdict, and none for a merged or closed PR.

## Install

```bash
git clone <this repo> ~/.claude/skills/senior-pr-review
```

Any directory under `~/.claude/skills/` works; the skill resolves its own path from the harness. Requirements: `git`, `gh` (authenticated), `python3`. Optional: `acli` for Jira tickets, a Sentry MCP for error signals.

## Use

In Claude Code, inside the repo you want reviewed:

```
/senior-pr-review            # current branch vs the default branch
/senior-pr-review PR 1234    # a pull request
```

Reports land in a sibling directory of the repo named `<repo>-pr-reviews/`, as `<pr-number>-review.html` (or `<branch-slug>-review.html`), and the reply links them as a clickable `file:///` URL. Override with `PR_REVIEW_OUT_DIR` and `PR_REVIEW_BASE`.

The skill never posts to GitHub or edits code on its own. Say "post all" or "post #1, #3" after a review to post the sidecar comments.

## How it reviews

Three axes, kept separate so one cannot mask another:

First, every PR goes through a universal gate: the problem is restated from the raw signal (ticket first report, Sentry, logs), checked for root cause vs symptom, and the new tests are run against base, where they must fail.

- **Correctness**: the main pass. Reads the diff and the unchanged code it interacts with, with domain lenses from `lenses/` selected by what the diff touches (adversarial, tests, a11y, abuse, hardening).
- **Spec**: a sub-agent checks the ticket's acceptance criteria against the code.
- **Standards**: a sub-agent checks the repo's documented rules plus a fixed set of code smells.

Sub-agent output is a candidate list. The main pass verifies every candidate against the current head before it publishes. At most five findings by default.

## Per-repo profiles

`profiles/<repo-name>.md` adds what is specific to one repo: the ticket system and fetch command, standards sources, a docs index, extra lens triggers, overlay findings, and a known-dismissed list. A file named `.senior-pr-review.md` at the repo root does the same and wins on conflict. Without a profile the skill uses generic defaults (GitHub issues, `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md`, no overlays).

`profiles/change-elections.md` is the shipped example.

## Scripts

- `scripts/tests_on_base.sh <base> -- <test cmd>`: runs the tests on head, then with every changed non-test file reverted to base. Prints `proves`, `does-not-prove`, `import-error` or `head-fails`.
- `scripts/diff_coverage.py --base <ref> --lcov <file>`: coverage on the changed lines only.

## Layout

```
SKILL.md          the review protocol
lenses/           domain checklists, selected by trigger
profiles/         per-repo context
scripts/          tests on base, diff coverage
```

## Maintenance

- A domain miss goes into `lenses/<name>.md`.
- A finding rejected twice on a PR for the same reason goes into the repo's profile under Known dismissed.
- A review-process miss goes into `SKILL.md`.
- Bump `version` in the `SKILL.md` frontmatter on every change; it is stamped into each report.
