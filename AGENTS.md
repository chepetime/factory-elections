# Factory agent entry point

Use pnpm and Node 26+. Work in an isolated checkout; anchor commands to its absolute path and preserve other agents' edits.

- Worktrees: `node scripts/worktree.mjs new agent/my-task HEAD --install`; [lifecycle](docs/worktrees.md).
- Fullstack: `node scripts/worktree.mjs run 3001 4320` with free ports; [local running](docs/harnes/RUNNING.md).
- Dev server on main or in a worktree: [operations](docs/operations/dev-server.md). Docs site: `pnpm docs` (http://localhost:3100).
- Browser review: `pnpm storybook` for components; use [browser checks](docs/harnes/BROWSER.md) for flows.
- Terminal work: scope `rg` to the owning package, then run its focused check; [commands and output](docs/harnes/TERMINAL.md).
- CI or changed checks: [selection and caching](docs/agents/ci.md).
- Architecture or terminology: [code map](docs/harnes/CODE_MAP.md), then only the linked domain document.
- Common changes (add an RPC, add a rail page, where data lives): [recipes](docs/harnes/RECIPES.md).
- Restart, screenshot, inspect state: `pnpm restart --dry-run`, `pnpm shot <path>`, `pnpm -s factory paths|issue show|review diagnose|spans`; the full loop is the `factory-dev-loop` skill.
- Harness experiments: [learnings](docs/harnes/LEARNINGS.md).

Read only the pointer relevant to the task. Load skills when explicitly requested or when their workflow is necessary; load MCP tools only for the external capability the task needs. Keep tool output bounded and report the outcome, validation, and remaining limitation briefly. Change approach after repeated identical failures.
