# Agent pickup

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| Agent pickup — core/backend | todo, unassigned → routed → assigned → started (after its blockers are Done, or stacked on one open PR), or retry later | Keep `pickupPlan` pure and the retry delay. Routing asks once per task edit. |
