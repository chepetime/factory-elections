# Run this checkout

Install with `pnpm install --frozen-lockfile`. For isolated fullstack run `node scripts/worktree.mjs run 3001 4320` with available web/backend ports; it assigns checkout-local data and refuses backend reuse. `pnpm web -- --dev` starts the backend and Next.js; `pnpm web` builds and serves production mode. `pnpm backend` runs only the service.

Before starting a concurrent stack, use [worktree setup](../worktrees.md) for isolated ports and data. The plain launcher reuses any authenticated backend at its configured address; a successful connection alone does not prove it runs this checkout's code. Never reuse a different agent's backend to validate backend edits.

Default endpoints are web `http://localhost:3000` and health `http://127.0.0.1:4318/health`; for `pnpm worktree run 3001 4320`, use web `http://localhost:3001` and health `http://127.0.0.1:4321/health` (optional third argument overrides the health port). Confirm HTTP success and inspect the health JSON, then exercise the changed route. Keep the process handle and stop only processes this session owns. The launcher drains its own backend on shutdown.

Storage setup or migrations: [Docker storage](../docker-storage.md). RPC credentials, health semantics, shutdown and recovery: [local backend](../local-backend.md). The app can invoke real agents and write project data; use disposable data for experiments and avoid executing tasks merely to check rendering.
