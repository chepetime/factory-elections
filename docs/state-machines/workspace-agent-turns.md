# Workspace agent turns

Part of [the state-machine index](../state-machines.md).

A workspace agent's session (`agentRun`, settle logic in `packages/driver/src/agent-settle.ts`) runs in turns. After each turn the driver commits what changed, then settles by recorded state, never by what the agent says (ADR 0103): commits on the branch since base, and what the agent set with `set_status` and `comment`.

A turn that changed nothing is steered once before it blocks the task, because a progress note ("tests still run; I commit next") looks the same as "nothing to do". The driver resumes the same session with a message from Factory, in the same way as a verification fix turn (and counted with those turns, `AGENT_FIX_TURNS`): finish the work and commit if it is in progress, run background work in the foreground (the CLI stops it when the call ends), or say why no change is needed and call `set_status blocked`. When the turn's events show a `Bash` call with `run_in_background` or an async subagent, the prompt names it. The steered turn gets the task budget left after the first. Only the next no-change turn settles the task as `blocked`, with the agent's last message in the text.

- `set_status blocked` together with a task comment is a real question: it settles at once, with no steer. `blocked` with no comment is steered.
- A follow-up on an open PR whose head did not move goes back to `pr-opened` with no steer: a PR that needs no change is a valid outcome.
- The attempt records `no_change_steered: true` as soon as the steer is decided. A later run (restart, reply) that finds it on the latest attempt settles a no-change turn without steering again. A turn that changes something leaves the mark off, so the next reply gets a fresh steer.
