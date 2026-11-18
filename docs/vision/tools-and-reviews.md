# Tools and automated PR reviews

Part of the [product vision](../../VISION.md). [control.md](control.md) states the tool rules. This document says what each stage needs and how the backend gives it. [TODO.md](../../TODO.md) has the tasks.

## Where it stands

- Agents reach GitHub and Jira through `gh` and `acli` in Bash, with the signed-in user's credentials.
- The only MCP tool is `delegate`. Runs do not get user MCP servers, skills or plugins.
- Automated review turns cannot post. A deny list blocks `gh pr review`, `gh api` and similar commands. A deny list on shell commands is fragile: a wrapped or renamed command can get through it.
- PR reviews start when a person starts them, or once when a factory PR opens.

## Decision: the backend is the tool broker

The backend runs one MCP server per run, like `delegate` today. It exposes only the tools of the run's project, at the access level of the step.

- **Credentials stay in the backend.** An agent never sees a token. Thus a prompt injection in a PR, ticket or Slack message cannot take a token out.
- **Every call is a span,** with the tool, the access level, a short summary of the arguments with secrets removed, the result size and the duration.
- **Writes have three levels:**
  - `read`: no change outside the machine.
  - `draft`: a change that only I can see, for example a pending GitHub review or a local note.
  - `publish`: a change that other people can see, for example a review comment, a Jira transition or a Slack post.
- **A `publish` write goes to the inbox** for my approval, until earned autonomy (step 9) lets a task class post without approval.
- **Shell access to the same services is removed** when a broker tool covers it. Then the deny list is a second layer, not the only one.

## Tool needs by stage

| Stage | Read | Write |
| --- | --- | --- |
| Grill | Jira issue and links, Confluence pages, Fathom meeting notes, Slack threads | none |
| Spec | Confluence, Figma frames, the repo | draft: the spec |
| Board | Jira project (types, components, epics) | publish: Jira tickets |
| Implement | the repo, package registry, local services (Docker), web docs | git in the worktree only |
| QA | the running app in a browser, behind a proxy; Figma for UI checks | draft: screenshots and the QA report |
| Tend | PR, checks, CI logs, review threads | publish: thread replies, pushes (fast-forward only) |
| PR review | PR diff and files, base branch, history and blame, CI status and logs, linked Jira ticket, earlier comments by people, Sentry for the files touched | draft: a pending review; publish: the review after approval |
| Retro | the span ledger, review outcomes | draft: proposals in the inbox |
| Upstream | Jira backlog, Sentry and New Relic incidents, review findings | draft: proposed specs |

## Automated PR reviews

The factory reviews team PRs as well as its own. A review is a draft until I approve it. The factory never approves or merges a PR itself.

1. **Watch.** Every few minutes the backend reads the open PRs of each project.
2. **Select.** A review policy per project decides which PRs get an automatic review. It can use: my review is requested, labels, paths, size, author, draft or not, bot authors and release PRs.
3. **Size the review.** Risk sets the depth and the budget. Risk comes from the diff size and the paths touched, for example migrations, auth, payments and infra. A small, low-risk PR gets a single pass. A high-risk PR also gets a second opinion from the other provider.
4. **Gather context** through the broker: the diff, the linked ticket (for the spec axis), CI results, and the comments that people already left.
5. **Review** with the senior-pr-review skill. The turn has read tools only.
6. **Draft.** The backend posts the findings as a pending GitHub review, with inline comments on the right lines. A `review` inbox item opens. I edit, remove or approve each finding, then the backend submits the review.
7. **Re-review on push.** Only the new commits are reviewed. Earlier findings are marked fixed, still open or no longer relevant.
8. **Follow up.** When the author replies to a finding, the agent proposes an answer for my approval.
9. **Learn.** Each finding has an outcome: fixed, dismissed by me, disputed by the author, or resolved without a change. Issues that people found and the agent missed count against recall. Reverts and incidents on reviewed PRs count as misses too.

For factory PRs, the self-review runs before I see the PR. Its blocking findings go to tending as fixes before the PR reaches my inbox.

## Review metrics

- Time to first review on team PRs, with and without the factory.
- Cost per review, by risk tier.
- Precision: the share of posted findings that led to a change.
- Recall: issues that people found and the agent missed, and reverts or incidents after an approved review.
- My time per review: the time spent on the draft at the inbox.
- Agreement between Claude and Codex on second-opinion reviews.

## A review panel: specialist reviewers under one lead

### Where it stands

The senior-pr-review skill already splits the work, but inside one Claude session:

- One lead on Opus (`REVIEW_MODEL`) does the Correctness pass and explores the repo itself.
- At Medium and High risk, it starts two Sonnet sub-agents with the Agent tool: Spec and Standards.
- At High risk, it also starts lens sub-agents (hardening, abuse, a11y) when more than about 80 lines trigger them.
- The sub-agents are not factory runs. They have no spans of their own and no budget of their own. Their cost is only what the lead writes in the payload's `cost.subagents`.
- Each sub-agent and the lead read the diff and explore the repo on their own.

### The proposal

Keep senior-pr-review as the lead and as the rules. Move the orchestration from the prompt to the backend. Each specialist becomes a factory child run with its own model, budget and span.

1. **Context bundle (no model).** The backend collects the material once per head SHA: the diff and the stat, the commits, the linked ticket, CI status and failed logs, the base versions of the touched files, the callers outside the diff, history and blame, the project's review profile, and the results of `tests_on_base.sh` and `diff_coverage.py`. Every reviewer gets the same bundle as the start of its prompt. Thus the bundle is read from the cache after the first reviewer.
2. **Triage (no model, or Haiku).** Risk, size and the lens triggers are mostly path rules (the table in the skill's §2b and §3c), so the backend computes them. A small model checks only the cases that the rules leave open.
3. **Specialists, in parallel.** Each one gets the bundle, its lens text and only the hunks that trigger it. Each one returns candidates in a schema: file, lines, the quoted hunk, the evidence, a proposed severity and a confidence.
4. **The lead judges.** senior-pr-review on Opus checks each candidate against its evidence, removes duplicates, applies `false-positives.md` and the profile's known-dismissed list, keeps the cap of 5 findings, and writes the payload. It does not explore from the start; it verifies.

### Specialists

| Specialist | Fires when | Model (first guess) | Source |
| --- | --- | --- | --- |
| Correctness | always | Opus at High risk, else Sonnet high | the skill's own pass |
| Spec and ticket fit | a linked ticket, Medium and High | Sonnet | §3b Spec sub-agent |
| Standards | Medium and High | Sonnet, or Haiku for the mechanical part | §3b, `cleanup.md`, `conventions.md` |
| Tests and proof | source or test files changed | Sonnet, with the script results | `tests.md`, §3a |
| Security | `hardening` or `abuse` fires | Opus at High risk | `hardening.md`, `abuse.md` |
| Accessibility and UI | UI files changed | Sonnet; browser when a preview runs | `a11y.md` |
| Data and performance | migrations, SQL, queries, hot paths | Sonnet | new lens |
| Adversarial second opinion | High risk | Codex | `adversarial.md` |

Low risk keeps one pass on Sonnet, with no panel. Most PRs are small, and today every review runs on Opus.

### Why this can cost less and find more

- **Less:** the expensive model judges and does not explore. Exploration becomes a bundle that no model pays for. Specialists share a cached prefix. Low-risk PRs leave Opus completely.
- **More:** each specialist has a clean context and one point of view, which is the reason the skill already splits Spec and Standards. A different provider (Codex) misses different things than Claude. The lead's evidence check keeps the precision.
- **The risk:** more agents read more tokens in total, and a small PR pays for orchestration that it does not need. So the panel runs only at Medium and High risk, and only the specialists whose triggers fire.

### Prove it before the switch

- **A benchmark set:** about 30 merged change-elections PRs with known results: the comments from people that led to a change, and the reverts and hotfixes after merge.
- **Run both** the current skill and the panel on the set, with replay. Compare precision, recall, cost and wall time.
- **Grade each specialist:** how many of its candidates survive the lead and lead to a change, against its cost. A specialist that adds cost but no surviving findings moves to a cheaper model or is turned off for that project.
- **Keep the chat.** Reviews that a person starts in the app keep the current single-session skill. The panel runs the automatic reviews first.
