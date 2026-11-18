# Lens: Tests (coverage and assertion quality)

Did the author add or update tests for the behavior they changed? Do the tests actually assert something meaningful, or do they just execute the code?

This pillar fires whenever the diff touches any source or test file — including when the author *did* write tests. Reviewing the tests that were added is as much this pillar's job as noticing the ones that are missing; a test that executes the new code without asserting on its behavior is a coverage gap wearing a passing check.

## What to flag

### Coverage gaps

- New exported function / hook / component / class / resolver without any test
- Modified function whose behavior changed without a test update
- New branch (`if`/`else if`/`case`) added without a test that exercises it
- New error / exception path without a test that triggers it
- New async path without a test for the failure mode (rejection, timeout)
- New GraphQL resolver without a resolver test
- New Prisma repository method without a repository test
- New React component without at least a render test (Storybook story is not a test substitute)
- New cron / queue processor without a processor test

### Weak assertions

**The test to apply: could I break the code and still see green?** Pick the boolean, constant, or method name the new behavior hinges on, mentally flip it, and ask whether any assertion fails. If not, the test is decorative. This is the single most productive question in this pillar — it's where the sharpest review comments on this repo come from.

- Tests that call the code but assert nothing (`expect(x).toBeDefined()` on a clearly-defined value)
- Tests asserting only that no error was thrown — fine as a smoke test, weak as the only assertion
- `expect(result).toEqual(result)` or similar tautologies
- **An assertion that is vacuous given the fixture chosen.** The call short-circuits before reaching the asserted behavior, so the expectation holds for a reason unrelated to what's being tested — e.g. asserting on which share channel was recorded while using a fixture whose missing id makes the recorder return early. The fix is a fixture that reaches the code, not a stronger matcher.
- **An assertion that also passes on the inverse of the invariant it claims to check.** A substring scan for a field name passes whether the predicate is `{ x: null }` or `{ x: { not: null } }`. If a `toEqual` above already pins the exact shape, extending that is stronger than adding a scan.
- **An assertion aimed at a call the code no longer makes.** After a refactor from `update` to `updateMany`, a test asserting `update` was not called passes no matter what — the flag that decides whether content comes down is no longer pinned by anything. When a diff changes which client method is used, check that the negative assertions moved with it.
- **Loose matchers where an exact one is available**, per this repo's mutation-testing bar: prefer `toBe(3)` over `toBeGreaterThan(0)`, `toEqual` over `toMatchObject` / `expect.objectContaining`, and never assert with `toContain` against a serialized JSON blob.
- Snapshot tests where the snapshot is large, opaque, and not regenerated when behavior changes (the snapshot encodes the bug)
- Mocking the system under test (the test passes because the mock returned what was expected, not because the code did)

### Mocking traps

- Mocked database in a test that should hit a real one (integration tests must use a real DB to avoid mock/prod divergence)
- Mocking modules that should be exercised end-to-end (e.g. mocking the env-validation module to bypass it rather than testing that the validation works)
- Mocking time without controlling for timezone-sensitive behavior
- **A mock whose type annotation has drifted from the real export.** When a diff changes a function's return type, every `vi.mock` of it still annotated with the old type now describes a contract that doesn't exist and would let a test resolve a value the real function cannot return. Report it as staleness, not as a typecheck failure — `vi.mock` factory returns are not structurally checked, so this does not break the build.
- Mocks imported via relative paths (`../../`) where the package's other tests use the `@/` alias

### Edge case coverage

- Tests cover the happy path but not:
  - Empty input
  - `null` / `undefined`
  - Authorization failure
  - Network / DB failure
  - Concurrent invocation (if relevant)
- New validation logic without tests for both valid and invalid inputs
- New business rule without a test for the boundary condition

### Test placement and shape

- Tests not in the package's expected location (per its `jest.config.*` and existing layout)
- Tests using a framework or assertion library that the package doesn't use elsewhere
- Test names that don't describe the behavior under test ("works correctly", "test 1")
- Tests with multiple unrelated assertions where they should be split

### Mutation testing signals

If a mutation-testing run would catch surviving mutants in the changed code, the test suite has gaps that this pillar should call out. You don't need to run mutation testing — but if a new function has shallow tests (single happy-path call with one assertion), flag it as a likely mutation-survival site.

## What NOT to flag

- Tests for trivial changes (typo fixes, dependency bumps, doc-only edits)
- Demand for tests that the package itself doesn't conventionally test (e.g. don't require a test for a styled `<Button>` if the package's other components are visual-only)
- Pre-existing missing tests out of scope — untouched by this diff and no more load-bearing than before. A pre-existing gap the diff made matter more (the function is now on a new path, or its behavior changed) is in scope.
- Stryker / mutation testing setup itself (out of scope; that's tooling)

## Output

Return candidates only: for each one give file, line range, the quoted hunk, the concrete failing scenario (or attack scenario, or the user blocked) and the smallest repair. No severity tags; the parent review assigns severity after it verifies each candidate against the current head. If you find nothing of substance, return `No findings`.
