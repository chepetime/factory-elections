# Lens: Data and performance

Review migrations, queries and hot paths for concrete data loss, incorrect results and material changes in resource use. Verify the changed path and its callers against the base; don't infer scale or traffic without evidence.

## Triggers

- Migrations, schema definitions, SQL, database queries or data backfills.
- Changes to loops, serialization, caching, pagination or fan-out on a known hot path.

## What to check

- **Migration safety:** existing rows that violate a new constraint, destructive transformations, missing backfills, incompatible old and new application versions during rollout, and locks on a table whose size or availability requirements make them consequential. Trace the deployment order and rollback or recovery path.
- **Data correctness:** joins that duplicate or omit rows, filters that cross a tenant boundary, NULL and timezone handling, unstable pagination, and updates that can lose concurrent writes. Establish the relevant schema, cardinality and transaction boundaries.
- **Queries:** N+1 calls, repeated scans, unbounded result sets or missing pagination introduced by the diff. Check actual indexes, query shape and expected cardinality before claiming an index or plan is needed.
- **Hot paths:** newly unbounded memory, CPU, network or disk work; sequential I/O that grows with input; caches with incorrect keys, invalidation or lifetime. Identify the caller and a realistic input that exposes the change.
- **Concurrency:** non-atomic read-modify-write, inconsistent ordering or retry behavior that can duplicate or drop data. Describe the interleaving and the resulting observable failure.

## Do not flag

- Hypothetical large datasets or traffic, an index without evidence of a problematic query, or a micro-optimization without a material impact.
- Pre-existing issues that the diff does not introduce or worsen, or speculative migration failures excluded by the actual deployment procedure.
- Generic requests for benchmarks or tests without a specific failure scenario.

## Output

Return candidates only: file and line range, quoted hunk, concrete scenario, evidence from the schema, caller or execution path, impact, and smallest repair. Distinguish measured behavior from inference. If nothing meets that bar, return `No findings`. The lead verifies candidates, deduplicates and assigns severity.
