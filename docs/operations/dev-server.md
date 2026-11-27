# Run the local dev server

Two modes exist. Pick one before you start.

| Mode | Use when | Web | Backend gRPC | Health |
| --- | --- | --- | --- | --- |
| Main (live) | The owner tests changes on main as you make them | http://localhost:3000 | 127.0.0.1:4319 | http://127.0.0.1:4318/health |
| Worktree | An agent works on a branch, isolated from other agents | your choice, for example http://localhost:3001 | your choice, for example 4320 | backend + 1, for example http://127.0.0.1:4321/health |

The docs app runs separately on http://localhost:3100. See [Docs app](docs-app.md).

## Main (live session)

Work in the primary checkout on `main`. Do not create a worktree. Commit finished work to local `main`.

Start from a cold or warm machine:

```sh
pnpm start -- --dev
```

`pnpm start` removes a `backend.lock` from before the last boot, starts OrbStack and the Docker data services when storage is configured, then runs `pnpm web -- --dev` (backend and Next.js dev). Without `--dev` it builds and serves production mode.

Verify:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000   # 200
curl -s http://127.0.0.1:4318/health                             # "engine":"running"
```

### What needs a restart

| You change | Do this |
| --- | --- |
| `apps/web/src` | Nothing. Next.js dev reloads it. |
| `packages/ui` | Nothing. Next.js transpiles its source and reloads it. |
| `packages/backend`, `packages/driver`, `packages/core`, `packages/adapters-*`, `apps/backend`, `definitions/` | Restart the stack. The backend loads this code once. |
| `next.config.ts`, environment variables, dependencies | Restart the stack. Run `pnpm install` first for dependencies. |
| Storage schema | `pnpm data:migrate` from this checkout, then restart the stack. |
| `apps/cli` | Nothing. Each `factory` command starts a new process. |

Keep the same URLs and ports across restarts.

### Stop and restart

Send SIGTERM to the `node scripts/web.mjs` process. The backend then drains its runs and removes its lock.

```sh
pkill -TERM -f 'node scripts/web.mjs'
pnpm start -- --dev
```

Do not kill the process group with SIGKILL, and do not stop a background task in a way that skips the drain. A skipped drain leaves `backend.lock`. Drain can take as long as the active work (up to `FACTORY_DRAIN_GRACE_MS`, default 5 min).

If `pnpm start` reports a lock from this boot with a stopped process, confirm that no worker of that backend still runs. Then remove the lock and start again.

## Worktree

Create the checkout, then run the stack from it with three free ports (web, backend gRPC, health):

```sh
node scripts/worktree.mjs new agent/my-task HEAD --install
cd ../factory-elections--agent-my-task   # the path the command prints
node scripts/worktree.mjs run 3001 4320
```

The runner refuses to reuse another backend and keeps its state under `.turri/worktree-data`. Give each concurrent agent its own port triple. It does not start or isolate the Docker data services.

Stop it with Ctrl-C or SIGTERM to its `web.mjs`. Remove the checkout from another checkout with `node scripts/worktree.mjs remove agent/my-task`. See [Worktrees](../worktrees.md) for the full lifecycle.

## Rules for both modes

- Never run `pnpm data:up` from a checkout without `.factory-data.env`. It makes new credentials and recreates the shared containers, and every RPC then fails while `/health` stays green.
- Never validate backend changes against a backend that another agent started.
- The app can run real agents and write project data. Do not run tasks only to check rendering.

More detail: [Running](../harnes/RUNNING.md), [Local backend](../local-backend.md), [Docker storage](../docker-storage.md).
