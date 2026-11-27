# Run in production mode

Production mode serves the built web app with `next start`: no file watching, no compile on first visit, so pages answer at full speed. Use it to run the factory for real work; use [dev mode](dev-server.md) while you change the code.

```sh
pnpm prod
```

One command does the whole start, from a terminal on the primary checkout:

1. Refuses when something already answers on the web port (`PORT`, default 3000).
2. Installs the locked dependencies (`pnpm install --frozen-lockfile`). Skip with `pnpm prod -- --no-install`.
3. Runs `pnpm start` in production mode. That clears a `backend.lock` from before the last boot, starts OrbStack and the data services when storage is configured, builds the web app, starts or reuses the backend, and starts Next.js.
4. Prints `==> Ready: http://localhost:3000` once the web app and the backend health check (`http://127.0.0.1:4318/health`, `"engine":"running"`) both answer.

With the dependency and build caches warm it is ready in about 10 seconds; a cold build adds about 15. Keep the terminal open. Ctrl-C stops Next.js and drains the backend it started.

## After a change

Production mode does not reload. Every change, including `apps/web` and `packages/ui`, needs a new build and restart:

```sh
pnpm run restart --prod
```

`pnpm run restart` without `--prod` brings the stack back in dev mode.

## Troubleshooting

| Message | Cause and fix |
| --- | --- |
| `prod: http://localhost:3000 already answers` | Another server holds the port, often a dev stack. Stop it (`pnpm run restart --dry-run` names it), or set `PORT`. |
| `This shell runs inside a Claude Code session` | Start it from your own terminal. Agent turns started from an agent session inherit its permission limits. |
| `Backend lock … names a stopped process … from this boot` | A backend from this boot did not drain. Confirm its workers stopped, remove the lock, run again. |
| `pnpm install failed` | The lockfile and `package.json` disagree, or the registry is unreachable. Run `pnpm install` and read its error. |
| No `Ready` after 10 minutes | The servers keep running; the build or startup error is in the output above. |
