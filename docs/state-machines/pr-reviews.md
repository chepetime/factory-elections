# PR reviews

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| PR review — backend/core | no review → preparing → running → completed / failed / stopped / interrupted; a reply starts a new turn | Keep one derivation (`status`) from the turn files plus live ownership. A Stop that arrives after the turn ended no longer relabels a completed review as stopped. Every turn (kickoff, re-review, reply) starts only after the backend wrote the PR data into the run's `work` directory, and runs in an OS sandbox (writes to the review worktree and `work` only, no network, no `~/.ssh`, `~/.config/gh`, Keychains) without the PR's own settings or hooks; a failed fetch is named in the prompt and never blocks the turn. `AUTOMATED_TURN_DENY` is a hint, not a boundary: the sandbox is. |
| Review list/chat — reviews | no review / preparing / running / ended; waiting for a new turn | `preparing` now disables New review and Remove, as the backend refuses them. A refused re-review shows its error, and a failed start ends the wait for a new turn. |
