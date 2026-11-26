# Current architecture

This living document describes the implemented system. Update it when a change affects a boundary, workflow, storage owner, or execution rule. Keep proposed changes and historical judgments in dated assessments.

The factory turns work requested for a local repository into a verified and reviewed change. A person approves the exact reviewed commit before publication.

## System at a high level

```text
Browser -> Next.js server -> authenticated local gRPC backend
CLI ----------------------> backend / shared driver composition
                              |
                     services and scheduling
                              |
                     driver -> pure core rules
                              |
              provider, Git, process and storage adapters
                   |             |                |
             Claude/Codex    worktrees/GitHub    PG/S3 + files
```

The deployment unit is one local installation. Next.js serves the web interface. The backend owns long-running work. Postgres and S3-compatible storage run as data services. Git repositories, worktrees, and agent processes remain on the host. The Docs app reads repository Markdown through Fumadocs.

The browser does not own a run. A closed tab does not cancel accepted work.

## Main workflow

1. Register a local repository and approve its profile. The profile supplies commands and safety limits.
2. Submit a task. The backend reserves ownership and persists acceptance before it returns.
3. A worker obtains capacity. The driver classifies the task and runs the configured steps.
4. Implementation occurs in a task worktree. Verification runs repository commands. Review and the PR draft refer to the resulting commit.
5. The task waits for human approval. The driver checks that verification and review still match HEAD.
6. Publication checks the gate again, pushes the branch, finds or creates the PR, and stores the result.
7. Evidence finalization completes before ownership ends. A restart requeues work that never starts and marks active work interrupted. Uncertain process cleanup blocks a new run until confirmation.

Features add planning above this flow. Their service runs grill, specification, critique, ticket planning, and QA steps. Implementation tickets reuse task runs. Agent pickup supplies another entry point through the board. Reviews and chats add session continuity and their own interaction lifecycles.

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| Core | Domain schemas, stage rules, action blockers, execution outcomes, cleanup records, and provider capabilities. |
| Driver | Classification, implementation, verification, review, approval gates, and PR publication. |
| Backend | RPC, accepted work, capacity, command ownership, recovery, evidence, and feature services. |
| Adapters | Provider calls, host processes, Git, GitHub, filesystem access, database records, and artifact storage. |
| Web | Views and commands through the backend. Shared action rules determine available controls. |
| Definitions | Prompts, step definitions, and model ladders loaded by execution. |
| Docs | Repository Markdown rendered by Fumadocs. |

## Execution and safety

Task stage, live execution ownership, outcome, and cleanup are separate facts. The backend holds ownership through evidence finalization. Queued work can resume after restart. Work interrupted during execution requires reconciliation. Uncertain cleanup prevents a new run until a person confirms cleanup.

The provider router checks required capabilities. Backend composition selects Claude or a Codex transport. Codex batch execution is the default Codex path; an environment flag selects app-server execution. Guards, cost reporting, and cancellation capabilities differ by transport.

The driver binds verification, review, approval, and publication to commit identity. A changed HEAD invalidates earlier evidence. Revision clears approval. Publication and local persistence are separate operations; an external result can require reconciliation after failure.

Tasks, features, reviews, and chats retain distinct orchestration paths. They share backend controls, but lifecycle behavior remains distributed across their services.

## Durable data

Configured installations use Postgres for task records and S3-compatible storage for artifacts. File mode also exists. Profiles and feature files retain filesystem storage. A database backup alone does not contain all installation state.

The data adapter uses transactions and advisory locks. Artifact writes use bounded buffering and integrity checks. Configured storage failures do not cause fallback to stale file records. Evidence receipts bind claims to a commit and carry a local signature. The signature identifies the installation; it does not independently prove the quality of a change.

## Scope

The runtime operates on one local installation. Repositories, worktrees, and agent processes stay on the host. Feature planning builds on task execution. General project types, remote execution, and broader tool access belong to the product roadmap and are not implied by this architecture.

## Implementation references

- [Core execution](https://github.com/chepetime/factory-elections/blob/main/packages/core/src/execution.ts)
- [Driver](https://github.com/chepetime/factory-elections/blob/main/packages/driver/src/workflow.ts)
- [Backend](https://github.com/chepetime/factory-elections/blob/main/packages/backend/src/service.ts)
- [Provider composition](https://github.com/chepetime/factory-elections/blob/main/packages/backend/src/compose.ts)
- [Features](https://github.com/chepetime/factory-elections/blob/main/packages/backend/src/features.ts)
- [Storage](https://github.com/chepetime/factory-elections/blob/main/packages/adapters-data/src/index.ts)

## Assessments

- [26 November 2026 — main at ac0a5377](https://github.com/chepetime/factory-elections/blob/main/docs/architecture-assessments/2026-11-26-ac0a5377.md).
