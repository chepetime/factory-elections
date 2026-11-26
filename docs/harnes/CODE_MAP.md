# Find the owning layer

| Change | Start here | Read when needed |
| --- | --- | --- |
| Domain rules and schemas | `packages/core/src` | `CONTEXT.md`, `GLOSSARY.md` |
| Tasks board (issues, keys, drops) | `packages/core/src/issues.ts`, `packages/backend/src/issues.ts` | `docs/tasks-board.md` |
| Workflow execution and gates | `packages/driver/src`, `definitions/` | `docs/state-machines.md` |
| Run queue, worker and agent limits, stop before start | `packages/dispatcher/src` | `docs/local-backend.md` |
| RPC, memory, delegation | `packages/backend/src` | `docs/local-backend.md` |
| Run evidence: event log, span ledger, receipts, outcomes, experiments | `packages/evidence/src` | `docs/adr/0005-execution-contract.md` |
| Driver composition and local environment checks (CLI and backend) | `packages/compose/src` | `docs/local-backend.md` |
| RPC contract and client (proto, Methods, `backendCall`) | `packages/backend-client/src` | `docs/local-backend.md` |
| Provider execution | `packages/adapters-claude/src`, `packages/adapters-codex/src` | `docs/agent-execution-review.md` |
| Git, filesystem, storage, processes | matching `packages/adapters-*` | `docs/docker-storage.md` for data |
| CLI | `apps/cli/src` | `README.md` command section |
| Web and components | `apps/web/src`, `packages/affect-ui` | `apps/web/AGENTS.md`, `BROWSER.md` |

Read only the ADR in `docs/adr/` governing the boundary you change. Keep pure domain logic in core; adapters implement ports, and backend/CLI compose them. Runtime agent definitions and prompts live in `definitions/`; repository contributor instructions live in `AGENTS.md` and these task guides. They serve different consumers.
