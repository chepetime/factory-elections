# Factory agent entry point

Use pnpm and Node 26+. Work in an isolated checkout; anchor commands to its absolute path and preserve other agents' edits.

- Worktrees: `node scripts/worktree.mjs new agent/my-task HEAD --install`; [lifecycle](docs/worktrees.md).
- Fullstack: `node scripts/worktree.mjs run 3001 4320` with free ports; [local running](docs/harnes/RUNNING.md).
- Dev server on main or in a worktree: [operations](docs/operations/dev-server.md). Docs site: `pnpm docs` (http://localhost:3100).
- Browser review: `pnpm storybook` for components; use [browser checks](docs/harnes/BROWSER.md) for flows.
- Terminal work: scope `rg` to the owning package, then run its focused check; [commands and output](docs/harnes/TERMINAL.md).
- CI or changed checks: [selection and caching](docs/agents/ci.md).
- Architecture or terminology: [code map](docs/harnes/CODE_MAP.md), then only the linked domain document.
- Harness experiments: [learnings](docs/harnes/LEARNINGS.md).

Read only the pointer relevant to the task. Load skills when explicitly requested or when their workflow is necessary; load MCP tools only for the external capability the task needs. Keep tool output bounded and report the outcome, validation, and remaining limitation briefly. Change approach after repeated identical failures.

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):
- Core filter, always on: `antislop`: `.codex/skills/antislop/SKILL.md`
- UI / visual: `antislop-ui`: `.codex/skills/antislop-ui/SKILL.md`
- People: `antislop-human`: `.codex/skills/antislop-human/SKILL.md`
- Code comments: `antislop-code`: `.codex/skills/antislop-code/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.
<!-- antislop:end -->
