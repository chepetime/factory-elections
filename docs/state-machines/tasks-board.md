# Tasks board

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| Tasks board — core/backend/web | backlog, todo, in_progress, in_review, done, blocked, cancelled; status follows the latest run when the run is newer | Keep `dropAction` as the one drop rule for board, menu and backend. Only In progress starts work; the factory alone moves work into In review and Blocked. |
| Cross-project board — web | working, needs-me, in-review, ready, archived | Keeps its own columns: they also read the inbox and pull request state. "Ready" is the part of needs-you that has one clear step (open the pull request, merge). A failed task stays in Needs me when the inbox could not be read. |
| Cross-project board "Ready" — web | approved, no pull request → ready | The column reads `runNeed`. A test proves that each card in Needs me and Ready is a run where `runAttention` gives a person the next move (review, reply or problem). The column stays: the vision defines it as "what can I finish". |
