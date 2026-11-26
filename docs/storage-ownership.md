# Storage ownership

Every durable entity, where its authoritative copy lives, what serializes writes to it, and whether a backup must include it. Paths are relative to `FACTORY_ROOT` (default `~/.local/share/factory`). "Document store" means `storageFor(root)`: plain JSON files in file mode, and the `factory_documents` table when Postgres and S3 are configured ([Docker storage](docker-storage.md)).

Some entities are always host files, also in Postgres mode. A Postgres dump alone is therefore not a full backup.

## Entities

| Entity | File-mode path | Postgres-mode store | Writes are serialized by | Back up |
| --- | --- | --- | --- | --- |
| Project registry | `<project>/project.json` | `factory_projects` | one write at creation | yes |
| Repo profile | `<project>/profile.yaml` | host file (always) | the person editing it; approval rewrites it | yes |
| Project settings | `<project>/settings.json` | document store | the settings service | yes |
| Task record | `<project>/tasks/<id>/task.json` | `factory_tasks` | `command.lock` (file) or advisory lock (Postgres) | yes |
| Run record and pointer | `tasks/<id>/runs/<run>/run.json`, `tasks/<id>/latest-run.json` | document store | the task lock | yes |
| Run log and events | `runs/<run>/run.log`, `runs/<run>/events.jsonl` | `factory_artifacts` + S3 objects | one writer per run | yes |
| Session log | `tasks/<id>/session.json` | document store | the task lock | yes |
| Evidence receipt | `tasks/<id>/receipt.json` | document store | the task lock | yes |
| Receipt signing key | `receipt-key/private.pem`, `public.pem` | host file (always) | created once (`wx`) | **yes, privately**: without it no restored receipt verifies |
| Tending record | `tasks/<id>/tending.json` | document store | the tending service | yes |
| Task board | `<project>/issues.json` | document store | the board service's serial queue | yes |
| Profile check state | `<project>/profile-check.json` | document store | the profile check service | optional |
| Team | `<project>/team.json` | document store | the team service | yes |
| Experiments, outcomes, PR review records | `<project>/experiments.json`, `outcomes.json`, `pr-reviews.json` | document store | each store's serial queue | yes |
| Span ledger | `<project>/trace/spans-YYYY-MM.jsonl` | S3 objects + `factory_trace_events` | one writer per file | yes |
| Features | `<project>/features/<id>/` (`feature.json`, `spec.md`, `critique.md`, `qa.md`) | host files (always) | the feature step in progress (one per feature) | **yes** |
| Repository memory | `<project>/memory/` (`facts.json`, `sessions.jsonl`, `tools.json`) | host files (always) | the memory service's per-project queue | **yes** |
| PR reviews | `<project>/reviews/<number>/` | host files (always) | the review service's per-PR guard | **yes** |
| Workspace agents and chats | `.workspace/agents.json`, `.workspace/chats.json`, `.workspace/chats/<id>.json` | document store | each service's serial queue | yes |
| User settings | `user-settings.json` | document store | the user settings service | yes |
| Inbox dismissals | `inbox/dismissed.json` | document store | the inbox | optional |
| Storage configuration | `storage.json`, `.factory-data.env` | host files | the person who configures storage | **yes, privately** |
| Server logs | `logs/<instance>.jsonl` | host files | the running backend | optional |

These are runtime files, not part of a backup. The backend creates them again:

| File | Why it is not restored |
| --- | --- |
| `backend.lock` | It names the process that owns the root. A restored copy would block the next start. |
| `backend-token` | It is a local credential. The backend creates a new one, and the web app and CLI read it. |
| `tasks/<id>/command.lock` | It names a live owner. Recovery removes one whose process is gone. |

Repositories and task worktrees live outside `FACTORY_ROOT`. Back them up with Git or the filesystem. A task records its repository path, so restore the repositories at the same paths.

## Backup and restore

**File mode.** Stop the backend. Copy `FACTORY_ROOT` without the runtime files above. To restore, copy it back to a clean root. `packages/backend/test/restore.test.ts` checks this: projects, tasks, features, memory and receipts come back, the task still points at its repository, and its receipt verifies. Without `receipt-key/`, verification fails.

**Postgres mode.** Stop the backend. Back up these together, from the same point in time:

1. The Postgres dump and the S3 artifact objects ([Docker storage](docker-storage.md#persistence-and-backups)).
2. The host-only files under `FACTORY_ROOT`: `receipt-key/`, every `<project>/profile.yaml`, `<project>/features/`, `<project>/memory/`, `<project>/reviews/`, `storage.json` and `.factory-data.env`.

Restore in this order: the storage configuration, then Postgres and S3, then the host-only files, then the repositories. Then start the backend. Recovery settles runs that were queued or running ([Interruption and recovery](local-backend.md#interruption-and-recovery)).

## Known limits

- No restore test runs against Postgres and S3. `pnpm data:test` covers real-storage round-trips and import, but not a restore from a dump.
- Orphan S3 objects (objects with no `factory_artifacts` row) are not found or removed yet.
- Features, memory and PR reviews stay host files on purpose: they are local, per-project state, and nothing relates them to tasks in one transaction. Move one to the document store only when a transaction across it and a task becomes necessary.
