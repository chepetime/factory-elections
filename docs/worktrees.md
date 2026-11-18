# Worktrees

Create: `node scripts/worktree.mjs new agent/my-task HEAD --install`.
The printed sibling path is the checkout to work in. Omit `--install` for documentation-only work.
List: `node scripts/worktree.mjs list`.
Run from the new checkout: `node scripts/worktree.mjs run 3001 4320`.
Remove from another checkout: `node scripts/worktree.mjs remove agent/my-task`.

Creation uses committed files and a new branch. It preserves the source checkout's dirty state and never copies secrets, node_modules, or generated files. pnpm reuses its content-addressed store while each checkout gets independent dependency links. Setup installs the frozen lockfile only; it does not change the global `factory` symlink. An installation failure preserves the checkout for retry.

The fullstack runner requires three free ports: web, backend RPC, and health (defaults to backend + 1; pass a third argument to override) and isolates persisted state under `.turri/worktree-data`. Assign different port triples to concurrent agents. It refuses backend reuse and prints the selected web URL. The preflight port check is advisory (another process can race it); startup errors still need inspection. Docker data services are separate: this command does not start or isolate Docker, and copied configuration can still reference external services.

Removal retains the Git branch and refuses current/primary, dirty, untracked, ignored, or locked checkouts. Inspect and explicitly remove generated files or local secrets before retrying; there is no force option. Git branches and refs remain shared, so coordinate commits, rebases, and merges with other agents.

Design sources: [git-twig](https://github.com/leostera/git-twig) separates committed checkout data from local state and avoids shared writable source files; [worktree-cli](https://github.com/johnlindquist/worktree-cli) makes setup an explicit operation. This implementation uses stock Git and pnpm, with no new dependency or filesystem-specific clone behavior.

Verify: `node --test scripts/worktree.test.mjs` (temporary repositories, no application dependencies).
