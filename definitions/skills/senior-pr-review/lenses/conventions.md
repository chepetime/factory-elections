# Lens: Conventions (repo patterns)

Does this follow the conventions documented in this repo and applied in adjacent code?

You are checking the diff against:

1. The **CLAUDE.md / AGENTS.md / CONTRIBUTING.md excerpts** from the context bundle. These are the explicit, documented rules.
2. The conventions visible in **sibling files** of each changed file — naming, file structure, export style, test layout, error patterns.
3. The docs pages for the touched domain (from the profile's docs index, when one exists).

Document rules trump neighbor patterns. Neighbor patterns trump theoretical preferences.

## What to flag

**Naming and structure**
- File naming that diverges from the directory's pattern (e.g. `BallotCard.tsx` next to `ballot-list.tsx` — pick one)
- Exported symbol patterns differing from neighbors (default vs named exports)
- Variable casing inconsistent with the file or package
- Test file placement / naming differing from the package's pattern

**Module hygiene**
- Imports not using `node:` prefix for Node.js builtins (`"node:path"` not `"path"`) where the repo uses it
- Missing `@/*` path alias usage where the surrounding code uses it
- Workspace-package import patterns not matching neighbors (e.g. deep imports where package-root imports are the convention)

**Project-specific rules**
- Hand-edits to generated files (see `.claude/rules/generated-files.md`)
- New env vars without a matching entry in the repo's env schema
- Manual `dotenv.config()` calls in `main.ts` (env loading is handled by `ConfigModule.forRoot({ envFilePath })`)

**Framework patterns**
- `useEffect`/`useState`/`useMemo` where project patterns use an existing shared hook
- AdminJS patterns diverging from established style in back-office
- NestJS patterns diverging (decorator order, module structure, DI patterns)
- Prisma patterns diverging (raw queries where the project uses typed repositories)
- Fumadocs patterns diverging in `apps/docs`

**Comment and doc accuracy — check this first, it is the highest-volume review finding on this repo**

Every comment, JSDoc block, and doc sentence the diff *adds or leaves behind* is an assertion about the code. Read each one against what the code now actually does.

- **Timeless comments only.** No change narrative and no state history: "now returns", "we used to", "left this in", "held this below threshold", "not yet built", "follow-up review", "a restored guide share page". A comment describes the durable invariant and why it holds, in the present tense — anything phrased relative to this change goes stale the moment the PR merges.
- **A comment that misdescribes current behavior.** The classic: the diff widens a code path and the JSDoc above it still lists the old cases ("the legacy matcher only emits MEDIUM/LOW" when it escalates to CRITICAL on repeat hides). Trace the claim, don't skim it.
- **A doc block parked on the wrong symbol.** Behavior moved into a shared private helper but the contract paragraphs stayed on one of the public wrappers, so a reader of the other wrapper never sees the audit or idempotency rules that apply to it.
- **Prose that contradicts the code it documents,** or another section of the same page: an intro claiming a score "only opens a review case" above a table showing it also hard-hides; a page saying thresholds "live in tunable config" when they are named constants requiring a deploy.
- **A model/schema doc pointing at the wrong owner** — e.g. a schema comment saying a mapping lives in one service when the diff implements it in another.
- When a diff re-fixes a comment that a previous round already flagged, re-read the whole block — this repo has had the same JSDoc flagged three rounds running because each fix introduced a new inaccuracy.

**Documentation hygiene**
- A new MDX page added without frontmatter (`title`, `description`)
- A new page added without updating the parent `meta.json`
- Hand-edits to generated index or catalog files
- A domain doc page exists in `apps/docs/content/docs/**` but the diff makes a behavioral change without updating the page
- MDX callouts use `type="warn"`; `type="warning"` renders differently and two spellings on one page look like two different things
- A behavior the diff deliberately leaves unimplemented (no auto-unhide, no backfill of existing rows) documented nowhere — a one-line matrix row makes it a decision rather than a gap

**i18n**
- Hardcoded user-facing strings where the surrounding code uses the i18n system

**Deploy config (if `infrastructure/argocd/**` changed)**
- ArgoCD `ApplicationSet` generator changes that won't actually match the intended cluster/namespace (list/cluster generator selectors diverging from sibling applicationsets)
- Helm chart `values.yaml` keys added without the matching template reference, or template references to values that don't exist
- `ExternalSecret` / `SecretStore` changes diverging from the established chart pattern (wrong `secretStoreRef`, key path not matching the AWS secret naming convention used by neighbors)
- A new service's chart/applicationset added without the wiring its siblings have (image-tag value, namespace, cluster targeting)

## What NOT to flag

- Linter / typechecker noise
- Pure style preferences not codified in CLAUDE.md or visible in neighbors
- Convention complaints that contradict what the surrounding files actually do
- Aesthetic preferences (one-line vs multi-line formatting, blank lines)
- Anything where the documented rule and the neighbor pattern disagree without a clear winner — note the conflict and report it as a judgement call

## Output

Return candidates only: for each one give file, line range, the quoted hunk, the concrete failing scenario (or attack scenario, or the user blocked) and the smallest repair. No severity tags; the parent review assigns severity after it verifies each candidate against the current head. If you find nothing of substance, return `No findings`.
