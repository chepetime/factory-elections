# Lens: Hardening (auth / input / secrets)

Code-level security hygiene. Think like an attacker who has stolen a cookie, crafted a malicious request, or scraped your dependency tree.

**Scope boundary:** this pillar covers **code-level security hygiene** — authentication, authorization, input validation, secret handling, injection vectors, dependency safety. It does NOT cover service availability under load — that's the Abuse pillar.

## Triggers

**Server-side surfaces:**
- Code touching auth, session, token, password, payment, file upload, webhook
- Handlers accepting user input (GraphQL resolvers, REST controllers, server actions, form handlers)
- New env vars / secrets / config changes
- External-API call sites (`gh`, `Octokit`, fetch to third-party services)

**Client-side surfaces (UI component files):**
- New `<form>` posting user-controlled data, or a new form handler that submits non-constant input
- New `<input type="file">` or `FormData` with file content
- New server action exports (`'use server'` directive) accepting unstructured input
- New `Authorization` / `Cookie` headers being set or read in client code
- Reading or writing `localStorage` / `sessionStorage` / `document.cookie` with a sensitive-looking key (`token`, `auth`, `session`, `password`, `key`)
- New `dangerouslySetInnerHTML` with non-constant input
- New redirect to a URL composed from user input (open-redirect)
- New Stripe / payment-SDK initialization or charge call
- New OAuth callback handler / token-exchange flow

When the diff is a UI file, apply the lens below to the **client-side handling of sensitive data and input** (validation, storage, transmission) AND to the **server endpoint the client newly reaches** (if any). The client is a trust boundary too — anything that leaves the client unvalidated, or sits in storage exposed to XSS, is in scope.

## What to flag

### 1. Secrets management

- Hardcoded API keys, tokens, passwords, connection strings — anywhere
- New env vars without a matching entry in the repo's env schema or validation module
- Secrets read from places that aren't the typed env util (e.g. raw `process.env.X` in app code instead of the validated env schema)
- Secrets committed to `.env` files that aren't gitignored
- Secrets logged (`console.log({ token })`, structured logger with full request body)
- New use of a deploy-environment variable vs `NODE_ENV` — flag if the wrong one is used where the repo documents a distinction

### 2. Authentication and authorization

- New endpoint without `@UseGuards(AuthGuard)` / `@UseGuards(ApiKeyGuard)` that should require auth — recall that `BetterAuthMiddleware` does NOT enforce auth on its own
- Authorization based on role alone when resource ownership should also be checked (e.g. "user can edit Endorsement" without verifying the endorsement belongs to their org)
- JWT / session tokens stored in `localStorage` (XSS-exposed) instead of httpOnly cookies
- Missing `SameSite` on cookies that need it (`SameSite=Lax` minimum, `Strict` for highly sensitive)
- Authorization checks done client-side only (the server must enforce)
- Authorization checks happening AFTER the side effect they're meant to gate

### 3. Input validation

- User input flowing into:
  - Database queries — flag any string concatenation into SQL; Prisma's tagged-template `Prisma.sql` is safer
  - File paths (path traversal via `..`)
  - Shell commands (don't `exec` with user input)
  - URLs / fetch targets (SSRF — server-side request forgery)
  - HTML rendered as `dangerouslySetInnerHTML` without sanitization
  - Redirect destinations (open redirect)
- Missing Zod schema on a handler that accepts unknown input
- Schema that's too permissive (`z.string()` where a UUID / email / enum is expected)
- File upload handlers without:
  - Size limit enforced at middleware (not just validation)
  - MIME type allow-list (not deny-list)
  - Extension allow-list matching MIME
  - Filename sanitization (no `../`, no null bytes)
  - Content-type sniffing (browser may treat `.html` as HTML even if labeled `image/png`)

### 4. SQL and query safety

- Prisma `$queryRawUnsafe` with user input (use `$queryRaw` tagged template instead)
- Dynamic table/column names from user input
- Custom SQL in `.sql` migration files with hardcoded data that should be parameterized

### 5. XSS and output encoding

- `dangerouslySetInnerHTML` with content from user input or external sources, without sanitization
- HTML rendered server-side without escaping
- User-controlled URLs used as `href`/`src` without scheme validation (`javascript:` URLs)
- Email/SMS templates with raw user input substituted

### 6. CSRF

- State-changing endpoints (POST/PUT/DELETE) without CSRF protection where cookie-based auth is in play
- `SameSite=None` on session cookies without justification
- Same-origin assumptions broken by `origin: true` CORS

### 7. Error handling and information disclosure

- Stack traces exposed to clients (`res.json({ error: error.stack })`)
- Error messages revealing internal paths, DB schema, env, internal IPs
- Different error responses for "user not found" vs "wrong password" (user enumeration)
- Verbose Sentry tags being attached to user-visible errors

### 8. Dependency safety

- Newly added dependencies that:
  - Are typo-squat candidates (`reactt`, `lodahs`, etc.) — verify the package name
  - Are unmaintained (last published years ago)
  - Are abandoned forks
  - Duplicate something already in the dep tree
- Lock file missing from the diff when the manifest (`package.json` or equivalent) changed

### 9. Webhook and external integrations

- Webhook handlers without signature verification (e.g. Stripe / GitHub / Slack signed payloads)
- External API responses trusted without schema validation
- Retry logic on external calls without idempotency keys (causes duplicate side effects)

### 10. Secrets in CI / scripts

- New GitHub Actions referencing secrets without `permissions:` scoping
- Scripts that print env vars or write them to logs
- Secrets passed via command-line args (visible in process list)

## What NOT to flag

- Throughput / DoS concerns (those are Abuse pillar's job)
- Pure code style
- Pre-existing issues out of scope — unchanged by this diff, no more reachable, no larger blast radius. An issue this diff made *newly reachable* (new call site, new caller, new route) or gave a larger blast radius **is** in scope; report it at the severity the current risk warrants and note that the flaw pre-dates the diff.
- Theoretical issues without a realistic exploit path

## Output

Return candidates only: for each one give file, line range, the quoted hunk, the concrete failing scenario (or attack scenario, or the user blocked) and the smallest repair. No severity tags; the parent review assigns severity after it verifies each candidate against the current head. If you find nothing of substance, return `No findings`.
