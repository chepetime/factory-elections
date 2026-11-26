# Workspace agents

An agent is a named collaborator, such as Devin (🐸, a developer) or Mika (🦄, a chief of staff). An agent works board tasks in its own session, and you can chat with it. A new workspace starts with these two agents. You can edit them, archive them, or add more at http://localhost:3000/agents.

## Entity

`AgentProfile` in `packages/core/src/agent-profiles.ts`:

- Identity: `id`, `name`, `avatar`, `description`.
- Model: `model` (a Claude model), `effort`.
- Context: `instructions` (your notes) and `skills` (folders in `definitions/skills/` with a `SKILL.md`).
- Limits: `concurrency` (tasks at the same time, 1 to 5), `task_budget_usd` (one task's session, replies included).
- `auto_pickup`: starts its Todo tasks by itself (on by default).
- `pass_env`: env var names. Values are never stored.

The backend keeps all agents in one document, `<data root>/.workspace/agents.json`. Chats are in `.workspace/chats/<id>.json`, with an index in `.workspace/chats.json`. Project names cannot contain a dot, so `.workspace` never collides with a project.

## Agent runs

1. Set the task's **Agent** on the task page, or use **Assign work** on the agent's page.
2. Put the task in **Todo**. The agent starts it when it has a free slot (see Pickup below). You can also move the task to **In progress** to start it now. The run is a factory run with `workflow: agent`. The driver's `agentRun` in `packages/driver/src/workflow.ts` runs it:
   - It prepares the worktree, with no classifier step.
   - It runs one model session with `tools: edit`, the coder guard (`worktreeGuard`), the OS sandbox and the agent's budget. The session persists, so later turns resume it.
   - It commits what the agent left, then runs the profile's checks (verify).
   - The stage becomes `awaiting-approval` if the checks pass, `verification-failed` if they fail, and `blocked` if the agent asked for help or made no change.
3. There is no reviewer step. You review the change, approve it, and open the pull request, as for any run. The agent cannot push.

**Pickup.** `AgentPickup` (`packages/agents/src/agent-pickup.ts`) checks every 20 seconds, after a run ends, and after you change a task.
- It starts the Todo tasks of each agent with "Pick up Todo tasks" on, up to the agent's free slots. The order is priority, then the oldest task.
- A run waiting for you (in review, blocked) does not use a slot.
- It skips Backlog tasks, archived tasks, and tasks with an open run.
- If a start fails, the task gets one note with the reason, and the agent waits 10 minutes before it tries that task again.
- **Routing:** a Todo task with no agent gets one from the coordinator, Mika. The coordinator makes one model call with no tools, limited to $0.10, which returns an agent from the roster and a reason. The reason shows on the task. A "none" answer adds a note and is not asked again until you edit the task. Without an active coordinator, unassigned tasks wait for you.
- **New tasks:** a task from the prompt field goes to Backlog, or to Todo when "Start" is on. It never starts the old pipeline directly.
- Set `FACTORY_AGENT_PICKUP=0` to turn pickup off for the whole backend.

**PR text.** After the checks pass, the `pr-writer` step writes the PR title and description from the diff, the checks and the agent's own report. It follows the repository's PR template (`.github/pull_request_template.md` or the other paths GitHub reads), or the factory template (Summary, Evidence, Merge Danger) when there is none. A body that leaves out a template heading is asked for again once, then refused; the PR then uses the task text in the template's shape. You read the draft at the gate.

**Replies.** A comment from you wakes the agent's session, but only while the agent waits: `awaiting-approval`, `verification-failed`, `failed` or `blocked`. A comment on an approved, rejected or merged run starts nothing.

**Tools.** The session gets factory tools through its MCP grant (`packages/agents/src/agent-tools.ts`):

- `comment`: posts on the task as the agent.
- `set_status`: sets the task to `in_progress`, `in_review` or `blocked`. Done and cancelled stay with you.
- `delegate`: starts a child task, as for the coder.

## Follow-ups

A task whose PR is open is done, and its run is finished. More work on it is a **follow-up**: a workspace agent continues the same worktree, branch and PR (`packages/core/src/follow-ups.ts`, `Driver.followUp`).

- **Start one** from the task page (Follow up, under the run), or drag the Done card to In progress, which opens the same form. Pick the agent (default: the run's agent, then the task's assignee) and write instructions, or use the **Resolve merge conflicts** preset.
- **Safe start.** The driver fetches the PR branch and its base, fast-forwards the worktree to the PR head, and refuses a branch that diverged from it. A conflict follow-up merges the base in. A clean merge needs no agent and goes straight to verification. Otherwise the agent gets the list of conflicted files, and the driver refuses to commit while a conflict marker remains, and aborts the merge on failure.
- **Board.** The run goes through the usual stages again, so the ticket moves by itself: Todo while it waits for the agent, In progress while it works, Blocked when the agent asks for help (`set_status`), In review with the new commit. If the agent changes nothing, the ticket goes back to Done and the PR is unchanged.
- **Same gate.** Nothing reaches GitHub without your approval of the new commit. Opening the PR again pushes to the same branch and updates the task's own PR. A closed or merged PR stops it and asks you to reopen it or reject the task.
- **Automatic conflicts.** When PR tending is off for the project, the tending pass (every 10 minutes) adds a conflict follow-up for the task's agent when its open PR conflicts with the base, once per PR head (`TendingService.watchConflict`). With tending on, tending resolves conflicts itself and pushes after the tests pass.

**Review loop.** When an agent's change is approved and opened as a **draft** PR, the factory starts a senior-pr-review of it (`packages/backend/src/review-loop.ts`, rules in `packages/core/src/review-loop.ts`):

1. `critical` and `must-fix` findings go back to the agent as a `review` follow-up. Its fix is pushed to the same PR once the checks pass, without the approval gate: you review the whole PR on GitHub at the end. A fix that fails the checks or asks you something stops the loop, and the PR stays a draft.
2. After the fix is pushed, the PR is reviewed again. At most two fix rounds run.
3. When a review leaves nothing critical or must-fix, or after the second fix, the factory adds an **Automated review** section to the PR description (the `should-fix` findings left for you, and any fix that no review checked again) and marks the PR ready for review.

Each step is a line in the task's activity, and the state is in `tasks/<id>/review-loop.json`. A PR opened ready for review, or by the pipeline, is left to people.

Each follow-up is recorded on the run (`follow_ups`: kind, instructions, agent, who added it, the PR head) and in the task's activity.

## Chats

`ChatService` (`packages/agents/src/chats.ts`) runs one model turn per message and resumes the chat's session.

- A chat can have a project. The agent then reads that repository with read-only tools. A guard keeps the reads inside the repository and away from `.env` files and `.git`.
- The chat tools are `list_tasks` and `create_task`. A created task goes to Todo and starts no work.
- Each turn has a $1 budget. The reply shows as it grows (`partial`), and **Stop** ends it.
- A chat is deleted from the list only. The tasks it created stay.

## Safety limits

- **Claude only.** Agent runs and chats refuse Codex models, because Codex cannot screen tool calls.
- **Env vars.** A name in `pass_env` reaches a session only if the backend operator also lists it in `FACTORY_AGENT_ENV_ALLOW`.
- **MCP servers.** Sessions use only factory tools for now.
- **Not built:** custom CLI arguments, and access control (Factory has one user).
