# PR tending

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| PR tending — core/backend | open → rerun / merge-base / answer-threads / fix-ci / wait → stopped or ended | Keep `nextTendAction` as the pure decision, with the bounded fix count. A thread waits only on a trusted comment (write, maintain or admin access, or `tending.trusted_logins`) newer than the last answer; tending's own replies never count. The backend filters the comments before the decision. |
