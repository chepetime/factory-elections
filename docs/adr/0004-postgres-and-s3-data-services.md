# ADR 0004: Postgres and S3 file storage in Docker

Status: accepted (2026-11-17), following the user's explicit choice to keep apps on macOS and containerize the database and file storage.

## Context and decision

Task/run state was held in individual JSON files and logs in local JSONL/text files. A persistent backend now owns execution. Use Postgres for structured state and artifact indexes, and SeaweedFS's authenticated S3 API for artifact content. Docker Compose runs these two services only, each with a persistent named volume and loopback host port. Keep Next.js, the backend/worker, repositories, worktrees, editable profiles and local credentials on the host.

## Alternatives

- Files: simple and readable, retained for isolated tests and migration sources; no longer the configured application's authority.
- SQLite: a smaller local deployment, but the user selected containerized Postgres plus file storage.
- Postgres binary values for every file: possible, but separates artifact lifecycle and bulk content less clearly than S3 objects.
- Containerized applications: outside the requested scope and would change host repository, SDK authentication and sandbox access.

## Consequences

The existing core schemas and driver remain transport/storage independent. CLI composition and backend services select the same adapter from the root's private storage configuration. JSONB snapshots preserve existing task contracts while indexes and transactions improve state coordination. PostgreSQL advisory locks replace task lock files in configured mode.

Artifact uploads and metadata commits cannot be atomic across services. Use immutable chunks, content checksums and an index written after upload. Preserve structured trace/cost metadata in Postgres and complete content in S3. Flush model cost evidence at model boundaries and drain it on shutdown. Unreferenced uploaded objects can remain after a failed index transaction; automatic garbage collection is deferred.

An explicit, verified migration preserves source files and activates the new adapter only after import succeeds. No live dual-write to old task files and no fallback on database failure. Data services must be available before a configured backend starts. Both data volumes must be backed up consistently while execution is stopped.

The application is still a single local worker. This change does not add automatic crash recovery, distributed execution, service high availability, or idempotent GitHub reconciliation. See [the operational guide](../docker-storage.md).
