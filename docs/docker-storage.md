# Docker data services with host applications

Only the data services run in Docker:

| Component | Runs on | Persists |
| --- | --- | --- |
| Next.js, backend and worker | macOS | Runtime processes |
| PostgreSQL 18.7 | Docker | Project/task snapshots, run state, team assignments, artifact indexes and structured trace/cost metadata |
| SeaweedFS 4.54 (S3 API) | Docker | Full log/trace content and binary artifacts |
| Repositories and git worktrees | macOS | Source changes and check outputs |
| Profiles, definitions and local credentials | macOS | Editable host configuration |

Postgres and SeaweedFS use separate named volumes. Only `127.0.0.1:15432` (Postgres) and `127.0.0.1:18333` (S3) are published. Internal SeaweedFS administration ports are not published. The backend and Next.js retain their existing local ports.

SeaweedFS's single-node `mini` mode supplies an authenticated S3-compatible endpoint in one container; see its [official quick start](https://github.com/seaweedfs/seaweedfs#quick-start). The Postgres mount follows the [official image's version-18 layout](https://hub.docker.com/_/postgres).

## Start and activate

Start Docker/OrbStack, then:

```sh
pnpm data:up       # starts just Postgres and file storage, waits for both APIs
# Stop the backend before the first import; it must have no active task workers.
pnpm data:migrate # validates, imports, verifies, then activates the new storage
pnpm web -- --dev # Next.js and backend remain native macOS processes
```

`pnpm backend` or `factory serve` starts only the host backend. `pnpm data:status` shows container state. `pnpm data:down` stops data services and preserves their volumes. Bring them up before starting a configured backend; missing services produce an error, never a silent fallback to old task files.

`data:up` generates `.factory-data.env` with random database/S3 credentials and mode 0600. It is ignored by Git. This file supplies Docker Compose; do not regenerate it when reusing existing volumes. The configured backend/CLI discovers its connections through `<FACTORY_ROOT>/storage.json`, also mode 0600. No credentials are sent to the browser.

The existing app has been imported and activated. Repositories and worktree paths stay exactly where they were. The migration manifest is recorded in Postgres.

## Authority and import safety

In configured mode, Postgres is authoritative for task/project records and run/team metadata. Task schema validation, the workflow driver, Effect orchestration and exact-head approval checks are retained. Task writes update JSONB snapshots; indexes support project/stage lookup. File mode remains available for isolated tests and roots without a storage configuration.

Run acceptance and the latest-run pointer are committed in one database transaction. Per-task Postgres advisory locks are held on dedicated connections while work is queued/running, and are released when the connection closes. The host backend ownership file still prevents two servers owning one local root. This remains a single-worker local application, not a distributed scheduler.

The importer:

1. Acquires ownership so the backend cannot start during import; refuses active task ownership files.
2. Validates project and task records using the existing core schemas.
3. Rejects conflicting target records rather than overwriting them.
4. Copies run/team metadata and uploads log/trace files in immutable S3 chunks.
5. Verifies artifact bytes against their source and records a manifest.
6. Activates `storage.json` only after verification succeeds.

Original files are preserved as the pre-migration recovery copy. They are not updated after activation. A repeated import with the same active configuration does not overwrite newer database state. Profiles remain editable YAML on the host; the service reads their approved values at execution time.

## Logs and costs

The application uses logical artifact paths such as `<project>/tasks/<id>/runs/<run-id>/run.log`. In configured mode these refer to ordered immutable S3 chunks, not host files. Postgres records each chunk's key, size and SHA-256. Tail reads download only the chunks covering the requested suffix and verify their checksums.

Effect events include run/trace/span IDs, model, step, outcome and reported cost. Structured metadata is indexed in Postgres; complete JSONL and plain output reside in S3. Log message bodies are omitted from the trace metadata table. Unknown model costs remain null. Model responses flush their cost evidence before returning to the driver. Progress output flushes periodically, with an 8 MiB pending-upload bound; failed persistence stops further model work at the next boundary.

S3 and Postgres do not share a distributed transaction. Uploads precede the artifact-index transaction. A failure in that interval may leave an unreferenced immutable object; it does not create a database pointer to a missing upload. Failed buffers are reported rather than silently discarded. Abrupt process failure can lose output still in memory; automatic resume and cross-service recovery are not introduced here.

The health API and settings report Postgres and artifact-service availability. Shutdown drains accepted work and flushes evidence before closing the storage clients.

## Persistence and backups

Named volumes survive container replacement and ordinary `data:down`/`data:up`. This was checked by restarting both services after the initial import and reading the imported records and artifacts again. Volumes are not a backup.

For a consistent backup, stop the host backend first so no new artifact/index writes occur. Preserve together:

- A Postgres `pg_dump` in custom format (`pg_dump -U factory -d factory -Fc` inside the Postgres service).
- The SeaweedFS artifact volume, copied while the file service is stopped, or a complete S3 object export with its keys intact.
- `.factory-data.env`, the host `storage.json`, and project profile YAML files, stored privately.
- The host-only stores under `FACTORY_ROOT`: `receipt-key/`, `<project>/features/`, `<project>/memory/` and `<project>/reviews/`. Postgres does not hold them. See [Storage ownership](storage-ownership.md) for every entity.

Restore database and artifact data from the same backup point. Worktrees/repositories need their own Git/filesystem backup; they are deliberately outside Docker. The preserved original task files are only the import-time snapshot, not a backup of later runs.

## Verification

```sh
pnpm test          # fast suites; external-storage tests are skipped here
pnpm data:test     # real Postgres + S3 tests in isolated schemas
pnpm typecheck
```

The real-storage suite tests competing task owners, structured state, binary/log round-trips, indexed model costs, verified import/source preservation, and a complete scripted coding/verification/review/approval run through the host backend. It makes no paid model calls. Test schemas and referenced test objects are removed after completion.
