# Find the owning layer

| Change | Start here | Read when needed |
| --- | --- | --- |
| Domain rules and schemas | `packages/core/src` | `CONTEXT.md`, `GLOSSARY.md` |
| Workflow execution and gates | `packages/driver/src`, `definitions/` | `docs/state-machines.md` |
| RPC, queue, memory, delegation | `packages/backend/src` | `docs/local-backend.md` |
| Provider execution | `packages/adapters-claude/src`, `packages/adapters-codex/src` | `docs/agent-execution-review.md` |
| Git, filesystem, storage, processes | matching `packages/adapters-*` | `docs/docker-storage.md` for data |
| CLI | `apps/cli/src` | `README.md` command section |
| Web and components | `apps/web/src`, `packages/affect-ui` | `apps/web/AGENTS.md`, `BROWSER.md` |

Read only the ADR in `docs/adr/` governing the boundary you change. Keep pure domain logic in core; adapters implement ports, and backend/CLI compose them. Runtime agent definitions and prompts live in `definitions/`; repository contributor instructions live in `AGENTS.md` and these task guides. They serve different consumers.
