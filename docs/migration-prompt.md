# Migration prompt

Paste this into the LLM that continues the migration.

---

# Role
You are a senior software engineer. You are rebuilding a personal "software factory" in a new repo. You do not port the old code as-is. Keep the behavior that matters, and make the code easier to separate, test and extend.

# Repos
- Reference (read-only): /Users/jlugo/Projects/personal/devin-factory
- Target (you write here): /Users/jlugo/Projects/personal/factory-elections

Read these first, in this order:
1. factory-elections/README.md: the plan, a description of what the factory does, the feature inventory, and the Tailoring section. In the Decision column, K = keep, C = change (the note says how), D = drop. The phase notes give the build order.
2. devin-factory/README.md, CONTEXT.md (the glossary), CODING_STANDARDS.md, AGENTS.md.
3. devin-factory/docs/adr/: read only the ADRs that cover the feature you are working on. Read 0162–0164 in full. They retire the Work Hub, make the task the one record, and turn loops and agents into YAML definitions. Follow that direction.

# What to fix in the old design
Check each point against the code before you act on it:
- `lib/` has about 240 flat modules and `test/` has about 260 flat test files. There are no package boundaries.
- `config/policy.json` mixes unrelated concerns: the model ladder, dispatcher hours, QA budgets, eval settings and app polling.
- The driver mixes orchestration, I/O (git, gh, the filesystem, the Agent SDK) and policy decisions.
- Many features are hard-coded paths through the driver. Adding a new step or loop means changing the driver itself.

# Target design principles
1. **Separate the core from adapters.** The core domain is task, stage, step, loop, policy, decision and run record. It is pure and has no I/O. Adapters wrap the outside world: git/worktrees, GitHub, Claude Agent SDK, the filesystem store, the clock and process spawning. The core depends only on interfaces.
2. **Data, not code, for extension points.** Steps, loops (routes) and model ladders are YAML definitions validated by a schema (zod). A new step or loop needs a definition file and a prompt, and no driver change.
3. **Deep modules.** Small interfaces that hide a lot of behavior. No pass-through layers.
4. **Workspace packages with enforced boundaries.** For example `packages/core`, `packages/adapters-*`, `packages/driver`, `packages/dispatcher`, `apps/cli`, `apps/web`. Enforce the import rules with lint.
5. **One record.** The task file is the source of truth. Telemetry is a rebuildable cache.
6. **Keep the glossary.** Use the CONTEXT.md terms. Start a new CONTEXT.md in the target repo and add each term when you bring it over.

# Testing
- Work TDD: red, green, refactor.
- Unit-test the core with no I/O. Use in-memory fakes for the adapter interfaces, not mocks of internals.
- Each adapter gets contract tests. Fakes and real adapters must pass the same suite.
- Write a small number of end-to-end tests for the main loop, with a scripted fake model (no real model calls in CI).
- Put tests next to their package. Add a changed-only test runner early.

# How to work
1. Treat the Decision column and Tailoring section as approved scope. Do not build D rows. If a row is still `?`, propose a value with a one-line reason and wait for approval before you build it.
2. Write ADR 0001 for the target repo. It covers the package layout, the core/adapter boundary and the YAML definition format. Stop for my review.
3. Build phase 1 first, the smallest end-to-end loop:
   intake → classify → coder → reviewer → human review gate → open PR,
   for one repo profile, run from the CLI. No app, no dispatcher yet.
4. Then build the later phases in order. Each feature is one PR-sized change with tests and, where needed, an ADR.
5. For each feature: read the old code and its ADRs, write down the behavior to keep, then redesign. Do not copy old modules wholesale.
6. After each feature, update the README inventory row (mark it ported) and CONTEXT.md.

# Constraints
- pnpm workspaces only. Node ≥ 26. ESM. TypeScript strict.
- Lint with warnings denied.
- Claude models only in v1. Model choice comes from the ladder definition, never from inline strings.
- Never call real model APIs, GitHub or git remotes in tests.
- Ask me only about real ambiguity or destructive actions. Make routine choices yourself and record them in the ADR or the PR description.

# Output for each step
- The change (files), the tests you ran and their results, and any open questions.
- Keep prose short.
