# Learning 02: Isolation and affected validation

Date: 2026-11-17. Base: `9105ab9`; implementation branch: `harness/token-optimization`.

Worktree isolation requires three ports: web, backend RPC and backend health. Review caught the health endpoint retaining its default port; the launcher now allocates and checks all three. Checkout-local state and refusal to reuse another backend prevent testing another agent's code accidentally. Removal preserves branches and refuses ignored local files as well as tracked changes.

CI dependency selection must include relative cross-package test imports, not just package manifests. The selector includes those edges, expands transitive consumers, and selects all packages for unknown/shared inputs. Markdown-only documentation changes skip application checks. PR checks run once per PR update; main delivery builds artifacts without repeating the test suite.

Observed local validation: nine harness tests passed; application tests passed (107 Node tests, four skipped; 64 web tests across 15 files). Lint, root/web typechecking, changed-file formatting, pointer checks and diff whitespace checks passed. Dependency installation reused the local pnpm store without downloads. These results validate behavior locally, not hosted cache speed or deployment.

No previous CI or deployment workflow existed. Hosted workflow duration/cache-hit rates remain unmeasured. Production deployment requires a target; the delivery workflow currently uploads a commit-specific web build. Compare the same PR twice with cold/warm caches and record selected package counts, test counts, elapsed time and artifact identity before claiming CI savings.
