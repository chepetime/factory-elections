# Storage

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| Storage mode/init — data adapter | file or configured PG/S3; uninitialized → initializing → ready/failed → closed | Keep shared adapter selection/init and explicit failures. Never read stale file snapshots after activation. |
| Persistence — FS/PG adapters | validate → atomic write/transaction → snapshot | Keep runtime identities/schemas, atomic task writes and run/pointer transaction. No persisted task-union migration. |
| Artifact writer — data adapter | buffered → scheduled → serialized upload/index → drained or sticky failure | Keep bounded backlog, immutable chunks, checksums and upload-before-index. PG/S3 are not a distributed transaction; orphan objects are possible. |
| Migration — data migrate/scripts | unconfigured → locked/importing → verifying → activated or partial retry | Activate only after verification. Keep originals without dual writes; no migration on reads. |
| Data services/setup — scripts | missing/stopped → starting → healthy/error; install/link/update | Apps stay outside Docker. Data volumes persist independently of application processes. |
