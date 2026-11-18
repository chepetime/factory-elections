# Profile: change-elections

Applies when the repo root directory is named `change-elections`. Repo-local overrides live in `<repo>/.senior-pr-review.md`.

## Ticket system

Jira, project `VOTE` (older tickets use `CHANGE-`). Fetch the way the repo's `jira-cli` skill prescribes: the harness-brokered `jira` MCP (`jira_get_issue`) when that server is connected, otherwise:

```bash
acli jira workitem view <KEY> --fields summary,description,status,issuelinks,parent --json
acli jira workitem comment list --key <KEY> --json --paginate
```

Both calls are required. `workitem view` does not include comments unless asked, and the comment list returns them oldest first (`author`, `body`). When the ticket has a parent Epic, view the Epic's description too.

Never use the Atlassian MCP server (`mcp__atlassian__*`, `mcp__claude_ai_Atlassian__*`) or a raw REST call. If the branch and PR carry no key, run the repo's `find-jira-ticket` skill once before setting `jira_key` to `None`.

## Error tracker

Sentry, through the connected Sentry MCP (`get_sentry_resource` for a pasted URL, `search_issues` for an error message; `find_projects` lists the project slugs). Use it for the stack trace, event counts and the post-merge signal.

## Proof commands

Run proof steps from a checkout at the PR head with dependencies installed (a review worktree from `mise run worktree:new`, or `git worktree add --detach <dir> <sha>` followed by `pnpm install --frozen-lockfile`). Let the install guard clear before running pnpm.

- **Tests:** `pnpm --filter=<pkg> exec vitest run <test files>`. Find `<pkg>` from the nearest `package.json` `name`. `apps/data-pipeline-service` needs `pnpm exec vitest run` from its own directory.
- **Coverage:** add `--coverage.enabled --coverage.reporter=lcov --coverage.include=<changed source files>` to the test command; the lcov file lands at `<pkg dir>/coverage/lcov.info`. Every app ships `@vitest/coverage-v8`.
- **Mutation testing: do not run.** AGENTS.md says "Mutation testing is for humans only". Record `"mutation": "Not run: repo policy (AGENTS.md)"`.
- **Never** run `pnpm dev`, a full `pnpm test`, or `agent:verify` for a review. One dev stack per machine is enforced by a hook; reuse a running one for a High-risk repro, never start a second.

## High-risk paths (added to §2b)

`prisma/**`, `**/migrations/**`, `apps/auth/**`, `infrastructure/**`, `.github/workflows/**`, `packages/shared/**`, `@repo/api-env`, `@repo/web-env`, `@repo/shared-env`, `**/*.gql.ts` and the GraphQL schema, `agentic_workflows/**` (production LLM workflows), backfill and data-repair scripts.

## Direction sources (for `Needs attention`)

Before judging the approach, grep the docs (`apps/docs/content/docs/`) and AGENTS.md for the functions, services or patterns the diff extends, plus `deprecated`, `sunset`, `legacy`, `replaced by`. Check the ticket's parent Epic for a newer approach. A PR built on a deprecated path is `Needs attention`, with the replacement named.

## Standards sources

- `AGENTS.md` (Operating Rules, Code Economy, Hard Boundaries). Code Economy rules to quote: "A second copy means extract and parametrize", "No pass-through wrappers", "Delete dead code in the PR that removes its last caller".
- `apps/docs/content/docs/development/conventions.mdx`, the sections that match the changed areas.
- `.claude/rules/i18n-catalog.md` for catalog changes.
- Shared packages for reuse checks: `@repo/ui`, `@repo/shadcn`, `packages/shared/*`.
- Formatting and lint are covered by Biome, oxlint and pre-commit; never publish what they enforce.

## Docs index

`apps/docs/DOCS_INDEX.md`. Pick pages by the file paths in the diff.

## Lens triggers (added to the generic rows)

- `abuse.md`: `apps/api/**`, `apps/back-office-api/**`, `apps/data-pipeline*/**`, `**/resolvers/**`, `**/controllers/**`, `**/*.gql.ts`, `**/queues/**`, `**/cron/**`, `prisma/**`, `**/*.sql`.
- `a11y.md`: `apps/web/**`, `packages/frontend/**`, `@repo/ui/**`.
- `hardening.md`: env schema lives in `@repo/api-env`, `@repo/web-env`, `@repo/shared-env`; `DEPLOY_ENV` vs `NODE_ENV` distinction is documented in the root CLAUDE.md.

## Overlay findings

1. **Filesystem writes on ephemeral pods** (code changed) — `must-fix` for `fs.writeFile`, `fs.writeFileSync`, `fs.appendFile`, `fs.createWriteStream`, or `Bun.write`. Pods are ephemeral; the write is lost or fills the container. Exceptions: `/tmp`, stdout/stderr, and anything under `scripts/`.
2. **i18n catalog parity** (`packages/shared/i18n/src/messages/*.json` changed) — `must-fix` when a key is added or removed in `en.json` but not in `es.json` and `zh.json`; the parity test fails and the missing locale falls back to English.
3. **Hard Boundaries** from AGENTS.md are hard rules for the Standards axis: release or publishing commands, raw branch creation, manual edits to generated artifacts or changesets.

## Known dismissed

Drop any candidate these cover before publishing. Add a bullet when a published finding is rejected on a PR for the same reason twice.

- **A `.changeset/*.md` summary that reads like a branch slug.** Changesets are generated by `scripts/generate-changeset.sh`; the pre-commit hook renames the file to `pr-<N>.md` and fills the summary from the PR title on the next commit after the PR exists. Hand-editing them is against repo convention, so never flag slug-shaped wording and never suggest editing one.

  **This dismissal covers wording only.** A changeset whose summary *omits or misdescribes a behavior change the PR actually ships* is a legitimate finding — release notes are the only signal downstream consumers get, and this repo has accepted and fixed that exact comment before. Report it as should-fix against the **PR title** (which the hook copies into the summary), not against the changeset file, so the fix goes where the text comes from.
- **`as unknown as DocumentNode` and similar casts inside `@generated/` GraphQL output.** Codegen emits it; it is not hand-written and not actionable.
- **Missing regenerated codegen artifacts under `client/` or `@generated/`.** Those paths are gitignored, so their absence from a diff is expected, not drift.
- **"Add `select:` to narrow this Prisma `include`"** as a blanket performance fix. This repo forbids typecasts, and a scoped `select` frequently breaks Prisma→GraphQL assignability in a way that can only be resolved with a cast. Flag genuine over-fetching only when you can name a fix that does not require one.
- **A missing null guard on a value the surrounding types or a framework guarantee already make non-null.** Cite the type or the guard before claiming reachability.
- **`[NYT]` placeholder values in `es.json`.** Lokalise populates translations downstream; the placeholder is the correct committed state. A genuinely missing *key* in either catalog is still a finding.

  Equally, **real `es`/`zh` translations are not a violation.** `.claude/rules/i18n-catalog.md` states that message *IDs* are extract-generated and must not be hand-edited, but translation *values* "are fine to edit directly — these are what translators update," and non-default locales are "translated and committed alongside new keys." Never flag a hand-written translation value as drift. Deleting a key from a non-default catalog **is** wrong — `i18n:extract` re-adds it and the `i18n Catalog Drift` job gates on it.
- **`unitRef.get(X) as Mocked<X>` in a bare `TestBed.solitary` spec.** This is the repo's convention for that DI shape, not a violation of the no-typecasts rule. Real `@suites/unit` types `UnitRef.get<TDependency>(type: Type<TDependency>)` and returns `StubbedInstance<TDependency>`, inferring from the class argument — so passing `Mocked<X>` explicitly does not type-check, because a real class instance has no `mockResolvedValue` members. The cast-free `unitRef.get<Mocked<X>>(X)` form works **only** in specs going through `compileWithTransactionHost`, which defines its own `UnitRef` (`get<T = unknown>(token: unknown): T`) in `packages/shared/database/src/__test-utils__/suites-helpers.ts`.

  **Before believing a cited counter-example, check whether that file imports `compileWithTransactionHost`.** Two consecutive runs raised this finding citing a helper-based spec as proof it generalises to bare `TestBed` — first `pitch-read.service.spec.ts`, then `candidacy.queries.spec.ts`. Of the bare-`TestBed.solitary` specs in `apps/api/src`, every one that types its mock uses the cast; none use the explicit generic.
- **`OutreachPitch`'s `regionLandingPageElectionId` destination being "silently dropped" by the pitch read path.** The schema and `apps/docs/content/docs/architecture/social-outreach-pipeline.mdx` both describe three destinations, so this reads like a live gap — but `apps/back-office-api/src/adminjs/resources/outreach/create-pitch.ts` explicitly **refuses** a region destination at mint time ("Region landing page destinations aren't supported yet"), and that file holds the only `outreachPitch.create` in the repo (its sole `update` just connects a `shortUrl`). No such row can exist, so the read path cannot encounter one.

  The docs describe **intent**, not current behaviour. Verify the write path in code before reporting a "destination is unread" finding; two runs have reported this from the docs alone. A genuine finding here would first have to show a row can be created.
