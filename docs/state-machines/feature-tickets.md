# Feature tickets

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| Feature ticket — core/backend | waiting / waiting-merge → running → done or failed; failed → running on retry | State follows the ticket's task. `ticketRetryable` and `ticketAwaitsMerge` name which tickets accept `retry-ticket` and `mark-merged`. An unknown ticket id is refused. |
