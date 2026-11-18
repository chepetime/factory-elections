# Entities

Part of the [product vision](../../VISION.md).

The app has thirteen entities. Five exist for the whole team. Eight exist only for my own agent-run work.

| Entity | What it is | Key fields | Links to | Scope |
| --- | --- | --- | --- | --- |
| Project | A codebase and its work. The top of every roll-up | Name, repo, Jira project key, granted tools | Team members, features, tickets, PRs | Team |
| Team member | A person on the team | Name, Jira identity, GitHub identity | Tickets assigned, PRs authored, reviews given | Team |
| Ticket | A Jira issue | Key, type, status, assignee, created and resolved dates | Project, team member, PRs, task (when the work is mine) | Team |
| PR | A GitHub pull request | Number, author, state, opened and merged dates, reverted | Project, ticket, team member, task (when the work is mine) | Team |
| PR review | One review of a PR, by a person or an agent | Reviewer, verdict, findings, time taken | PR, team member, run (when an agent did it) | Team |
| Feature | An idea taken through the workflow | Title, stage, spec, cost | Project, tasks, gates | Mine |
| Task | One unit of work that agents carry out | Task class, size, stage, status, budget, cost | Feature, workflow, ticket, PR, runs, parent task | Mine |
| Workflow | The steps a task follows: full, quick fix, research or manual | Name, steps, YAML definition | Tasks | Mine |
| Run | One agent execution on a task | Provider, gateway, model, status, start and end, cost, outcome | Task, parent run, spans | Mine |
| Span | One traced step inside a run | Type, start, duration, tokens, cost | Run, parent span | Mine |
| Gate | A point where I approve | Stage, decision, time waited, time spent | Feature or task | Mine |
| Inbox item | Anything that waits on me | Kind, created, resolved, decision | Task, run, PR, gate or retro proposal | Mine |
| Tool grant | A tool that a project's agents may use, such as Jira, Slack or Fathom | Tool, access level, credential status | Project | Mine |

## How they connect

- A project has many team members, tickets, PRs and features.
- A feature has many tasks. A task can have child tasks.
- A task has one ticket, many runs and, when it ships, one PR.
- A run has a tree of spans, and can start child runs on any provider.
- A PR has many reviews. Each review comes from a team member or from an agent run.

## Open questions

- [ ] Are a ticket and a task the same thing? This draft treats the ticket as the Jira issue and the task as the work the app runs for it.
- [ ] Does a feature map to a Jira epic?
- [ ] Is a PR review only the agent's review of a PR, or also the reviews people give?
- [ ] Is there a team entity above team members, or do members belong directly to a project?

[CONTEXT.md](../../CONTEXT.md) has the terms the code uses today.
