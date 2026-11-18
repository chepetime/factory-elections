# Many agents, one control point

Part of the [product vision](../../VISION.md).

The backend owns every run. Thus agents on any provider can be budgeted, stopped and recovered from one place.

- Claude and Codex run side by side.
- An agent can start child tasks on any provider.
- The backend manages agent slots, budgets, git locks and recovery after a restart.
- The backend also holds the rules for what each provider can do safely.

Models can also be reached through a gateway: OpenRouter or a custom one. Pi runs as a third agent beside Claude and Codex. Each run records its gateway, so spend can be split by gateway.

## Factory controls

- Opening hours. Overtime needs a reason.
- A graceful **Stop** that lets runs finish, and a **Halt** that ends them now.
- Limits per repo and per effort level.
- A check for runs that died.
- A provider is skipped until its usage limit resets.

## Tools per project

Each project declares the tools its agents can use. The backend gives a run only the tools of its own project. For example, the Elections project grants Jira, Slack and Fathom.

- **Declared on the project.** The tool list is in the project's settings, not in prompts.
- **Granted by the backend.** The server holds the credentials and gives a run its project's tools when it starts. Child tasks get the same set, on any provider.
- **Isolated.** A run in one project cannot reach the tools or data of another project.
- **Scoped.** Each tool has an access level: read only, or read and write. A workflow step can make it narrower.
- **Traced.** Every tool call is a span, so tool use and its cost are visible per project.
- **Checked before the run.** If a task needs a tool that the project does not grant, or a credential has expired, the run does not start and an item goes to the inbox.
