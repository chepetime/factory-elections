# Workspace agents

An agent is a named collaborator, such as Devin (🐸, a developer) or Mika (🦄, a chief of staff). An agent works board tasks in its own session, and you can chat with it. A new workspace starts with these two agents. You can edit them, archive them, or add more at http://localhost:3000/agents.

## Entity

`AgentProfile` in `packages/core/src/agent-profiles.ts`:

- Identity: `id`, `name`, `avatar`, `description`.
- Model: `model` (a Claude model), `effort`.
- Context: `instructions` (your notes) and `skills` (folders in `definitions/skills/` with a `SKILL.md`).
- Limits: `concurrency` (tasks at the same time, 1 to 5), `task_budget_usd` (one task's session, replies included).
- `pass_env`: env var names. Values are never stored.

The backend keeps all agents in one document, `<data root>/.workspace/agents.json`. Chats are in `.workspace/chats/<id>.json`, with an index in `.workspace/chats.json`. Project names cannot contain a dot, so `.workspace` never collides with a project.

## Agent runs

1. Set the task's **Agent** on the task page, or use **Assign work** on the agent's page.
2. Move the task to **In progress**. The run is a factory run with `workflow: agent`. The driver's `agentRun` in `packages/driver/src/workflow.ts` runs it:
   - It prepares the worktree, with no classifier step.
   - It runs one model session with `tools: edit`, the coder guard (`worktreeGuard`), the OS sandbox and the agent's budget. The session persists, so later turns resume it.
   - It commits what the agent left, then runs the profile's checks (verify).
   - The stage becomes `awaiting-approval` if the checks pass, `verification-failed` if they fail, and `blocked` if the agent asked for help or made no change.
3. There is no reviewer step. You review the change, approve it, and open the pull request, as for any run. The agent cannot push.

**Replies.** A comment from you wakes the agent's session, but only while the agent waits: `awaiting-approval`, `verification-failed`, `failed` or `blocked`. A comment on an approved, rejected or merged run starts nothing.

**Tools.** The session gets factory tools through its MCP grant (`packages/backend/src/agent-tools.ts`):

- `comment`: posts on the task as the agent.
- `set_status`: sets the task to `in_progress`, `in_review` or `blocked`. Done and cancelled stay with you.
- `delegate`: starts a child task, as for the coder.

## Chats

`ChatService` (`packages/backend/src/chats.ts`) runs one model turn per message and resumes the chat's session.

- A chat can have a project. The agent then reads that repository with read-only tools. A guard keeps the reads inside the repository and away from `.env` files and `.git`.
- The chat tools are `list_tasks` and `create_task`. A created task goes to Todo and starts no work.
- Each turn has a $1 budget. The reply shows as it grows (`partial`), and **Stop** ends it.
- A chat is deleted from the list only. The tasks it created stay.

## Safety limits

- **Claude only.** Agent runs and chats refuse Codex models, because Codex cannot screen tool calls.
- **Env vars.** A name in `pass_env` reaches a session only if the backend operator also lists it in `FACTORY_AGENT_ENV_ALLOW`.
- **MCP servers.** Sessions use only factory tools for now.
- **Not built:** custom CLI arguments, and access control (Factory has one user).
