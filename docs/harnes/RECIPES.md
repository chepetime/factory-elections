# Recipes

Short, ordered steps for the changes agents make most. Each lists the files in the order to edit them.

## Add a backend RPC

1. `packages/backend-client/src/rpcs.ts`: add `Name: ['RequestMessage', 'ResponseMessage']` with a doc comment that says what `json` carries. Most RPCs use `SettingsUpdate` → `Snapshot` (a JSON envelope).
2. `pnpm rpc:generate`: writes the `service Factory` block of `factory.proto` and `src/descriptor.json`. `Methods` in `protocol.ts` derives from `RPCS`, so there is nothing to add there.
3. `packages/backend/src/service.ts`: a method that parses its input with zod and returns plain data.
4. `packages/backend/src/server.ts`: one handler, `Name: async (request) => ({ json: JSON.stringify(await service.name(...)) })`.
5. Web: a function in the matching `apps/web/src/lib/*.ts` that calls `backendCall('Name', …)` and parses with a core schema. When core has no schema for the response, add it in core, next to the type, with a type check that keeps both equal (see `packages/core/src/metrics-schema.ts`).
6. Tests: the backend method (node:test), and the page or lib (vitest with `@factory/backend-client` mocked). The contract test in `packages/backend-client/test` fails when step 2 was skipped.

## Add a page to the rail

1. `apps/web/src/app/<route>/page.tsx`: a server component with `export const dynamic = 'force-dynamic'` and `metadata`. Use the parts in `components/system-page.tsx` (header, stats, table, empty and error states).
2. `apps/web/src/components/app-shell.tsx`, `railGroups`: add `{ label, href, icon, active }` to Functions or System.
3. `apps/web/test/sidebar-navigation.test.tsx`: the group order test lists every item.

## Where data lives

`pnpm -s factory paths` prints them. Default data root: `~/.local/share/factory`.

| What | Path |
|---|---|
| Tickets, runs | Postgres when `<root>/storage.json` exists (data services); else files under `<root>/<project>/tasks/`. Read them with `pnpm -s factory issue show` or `task show`, not from disk. |
| PR reviews | `<root>/<project>/reviews/<n>/` (`run.json`, `turn-K.jsonl`, `turn-K.exit`, `payload.json`) |
| Stack log (restart, service) | `<root>/logs/stack.log` |
| Backend lock | `<root>/backend.lock` |
| A worktree's own data | `<worktree>/.turri/worktree-data` |

## Run a worktree's web against data

- Its own stack (safe, isolated): `pnpm worktree run 3011 4330`, then `FACTORY_BACKEND_PORT=4330 pnpm seed:demo` for demo data.
- Web only, reading the main backend (front-end changes only, no backend changes): `cd apps/web && npx next dev --webpack --hostname localhost -p 3107`. It reaches the main backend at `127.0.0.1:4319`.

## Look at a page

`pnpm shot /projects/<p>/tasks/<KEY>?panel=details --selector '#panel-timeline'`. Add `PORT=<web>` for a worktree stack. It prints the PNG path and any non-empty alert text.

## Restart the stack

From the primary checkout: `pnpm restart --dry-run`, then `pnpm restart`. See the [dev loop skill](../../.claude/skills/factory-dev-loop/SKILL.md) for the session and service rules.

## Known failure modes of stuck tickets

- **Verification lists source files as uncommitted, and the agent's transcript shows `tool "delegate" sent no response or progress for 300s`:** Claude Code stopped waiting for a silent `delegate` call, the parent turn ended, and the child kept editing while the factory verified. The factory MCP config now sets a per-server `timeout`, and the delegate server stops a child when its call is dropped or its grant is revoked (`packages/agents/src/delegation.ts`). If a branch already has the late edits, check that they are committed, then use **Run the checks again**.
- **A ticket stays In review, or at the gate, after its PR merged on GitHub:** before this fix, the tending pass read PR state only at `pr-opened`, so a PR merged while a follow-up was at the gate was never seen, and approve failed on the merged PR. The pass now reads the PR at every stage, settles the moot follow-up back to `pr-opened`, and sets the ticket Done (`packages/backend/src/tending.ts`, `settleEndedPr` in `packages/core/src/follow-ups.ts`). Wait for the next pass (10 minutes), or restart the backend.
- **A merge stops only on `pnpm-lock.yaml`:** the factory takes the base's lockfile, runs `pnpm install --lockfile-only`, and commits the merge itself. If that command fails, the lockfile goes to the agent with the other conflicts; read the backend log for the reason.
- **A failure the agent can fix (size limit, weakened tests, late edits, failing checks):** the agent gets two fix turns with the failure before the task waits for you. A task still at `verification-failed` used both; read its last fix turn before you reply.
