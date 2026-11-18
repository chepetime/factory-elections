# Lens: Abuse (DoS / availability)

**Primary threat model:** an unauthenticated outsider with a laptop and a script, trying to cause maximum damage to service availability with minimum effort and cost.

**Scope boundary:** this pillar covers **abuse resistance and survivability under adversarial load**. It does NOT cover code-level security hygiene (XSS, CSRF, SQLi, secrets) — that's the Hardening pillar.

## Triggers

**Server-side surfaces:**
- REST controllers or GraphQL resolvers / queries / mutations
- Prisma queries (especially `findMany` without `take`)
- BullMQ queue producers or processors
- `@Cron` jobs or scheduled tasks
- Endpoints in `data-pipeline-service`, `user-task-service`, `agentic-workflow-service`
- Internal endpoints (`/internal/*`, `/cron-processing/*`, `/workflow/*`)
- WebSocket, subscription, or streaming endpoints
- File upload or batch processing endpoints
- Connection pool, cache, or Redis configuration

**Client-side surfaces (UI component files):**
- New `fetch()` / `axios` / `ky` calls — especially against an endpoint not previously hit from this client
- New urql/Apollo `useMutation` / `useQuery` referencing a new operation
- New `.gql.ts` operation imports
- Server actions (`'use server'` files or directives) — they ARE backend surface, just authored in frontend code
- `EventSource` / `WebSocket` / streaming-subscription patterns
- `Promise.all` / loops that call the API more than once per user action

The lens below is written from the perspective of attacking *the backend*. When the diff is a UI file introducing a new way to talk to the backend, apply the same lens to the **endpoint the client newly reaches**, not to the React component. The question is: "what does this new client-side call let an attacker do to the server if they hit it from a script instead of the browser?"

## What to flag

### 1. Endpoint abuse

Repo posture: `origin: true` CORS, no `ThrottlerModule` or `express-rate-limit` anywhere. Every public endpoint is currently unthrottled. `BetterAuthMiddleware` validates the session cookie and sets user context, but does NOT reject unauthenticated requests — an absent or invalid cookie just continues anonymous, unless a specific `@UseGuards(AuthGuard)` or `@UseGuards(ApiKeyGuard)` is applied.

- Does the new endpoint require authentication? If not, why not?
- If unauthenticated, what is the most expensive thing a caller can trigger?
- Could an attacker call this in a tight loop to exhaust resources?
- For internal endpoints (`/internal/*`, `/cron-processing/*`): is there any auth guard? Most existing internal controllers have NONE.
- For `data-pipeline-service` CronProcessingController POST endpoints: invokable by anyone.
- For `agentic-workflow-service` WorkflowController: no auth — anyone can POST to `/workflow/execute/yaml`.
- Does `allowBatchedHttpRequests: true` in Apollo config let an attacker send arrays of expensive queries in one HTTP request?

### 2. Query amplification

GraphQL has depth limit (10) and complexity limit (1000, simple estimator). Simple estimator assigns cost=1 per field — dramatically underestimates list-field cost.

- Any new resolver using `findMany` without a `take` limit? Known unbounded: `Organization.endorsed`, `Person.websites`, `Person.degrees`, `Person.schools`.
- Can the new field be nested inside a list? List → person → unbounded endorsements → org → unbounded `endorsed`. Depth=10 doesn't catch all combinations.
- Does the query use `PrismaSelectField` to limit columns, or fetch full rows?
- DataLoaders (`@Loader`) for N-times-resolved fields? Missing loaders → N+1.
- For new `@Query` resolvers: cursor/offset pagination with max page size enforced?

### 3. Resource exhaustion

- **Connection pool:** can the operation hold a DB connection while waiting on external services?
- **WebSocket / Subscription flooding:** `graphql-ws` is enabled. Limit on concurrent connections per IP? Per user? `onConnect` currently only copies auth headers — does not enforce auth.
- **Redis memory:** queue jobs with large payloads, cache entries with no TTL, pub/sub with no subscriber limits.
- **File upload:** size limit at middleware level, not just validation?
- **Memory:** does the operation load all results into memory before processing? (`findMany` of all persons into an array before mapping).

### 4. Queue flooding

19+ named BullMQ queues. Queue flooding is a primary risk.

- Can the new code add jobs to a queue? Limit on jobs added per request?
- Endpoints accepting an unbounded list of IDs that enqueue per ID?
- Cron jobs enqueuing work without checking whether the previous batch finished?
- Per-processor concurrency limits configured? Backpressure or unbounded growth?
- `addBulk` used with data from an unbounded `findMany`?

### 5. Cache bypass

- New code path bypassing existing application or Redis caches?
- Can an attacker craft requests with unique parameters to pollute the cache?
- If caching is used: TTL? Can it grow unbounded?
- Do cache keys include user-controlled input that could be manipulated?

### 6. Cron conflict

`data-pipeline-service` has 13+ cron jobs, some scheduled simultaneously (multiple at 4AM Vancouver). Leader election prevents duplicate execution across instances, NOT overlap between different cron jobs.

- New cron job overlapping in window with existing jobs?
- Loading large datasets into memory?
- Skip-if-previous-still-running mechanism?
- Competing for the same queue capacity, Redis connections, or DB connections as other concurrent jobs?

### 7. Cascading failure

- DB slow → does the operation time out, or hold connections indefinitely?
- Redis down → graceful degradation? (BullMQ depends on Redis.)
- External API (BallotReady, Google Knowledge Graph) slow / down → circuit breaking, or retry forever?
- Operation timeout configured? (Express default: no timeout.)
- If this component fails, what else fails downstream?

### 8. Schema, index & integrity (if `schema.prisma`, a migration, or `.sql` changed)

Schema gaps become availability problems under load — an unindexed query an outsider can trigger repeatedly is a cheap amplification vector.

- **Missing indexes:** does a new (or newly-hot) query filter, join, or sort on a column with no index? An unindexed predicate on a large table is a sequential scan — name the table/column and the query that triggers it.
- **Unbounded growth:** does the change add a table/relation that grows with user input but has no retention, TTL, or cleanup path? (rows an outsider can create without limit → disk/connection exhaustion over time)
- **Missing constraints:** new columns/relations without the FK, unique, or NOT NULL constraints their siblings have — integrity drift that also defeats the planner's ability to use an index, and lets queries return/scan more than expected.
- **Wide rows on the request path:** new query fetching full rows (no `select`) where only a few columns are used, multiplying per-request cost.

## What NOT to flag

- "No rate limiting" without naming a specific expensive endpoint and the attack
- Theoretical risks requiring insider access an outsider can't have
- Pre-existing patterns out of scope — not introduced, no more reachable, no larger blast radius. A latent amplification the diff put on a new user-triggered path is in scope.

## Output

Return candidates only: for each one give file, line range, the quoted hunk, the concrete failing scenario (or attack scenario, or the user blocked) and the smallest repair. No severity tags; the parent review assigns severity after it verifies each candidate against the current head. If you find nothing of substance, return `No findings`.
