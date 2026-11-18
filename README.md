# Software Factory

Run a coding task against a local Git repository: classify it, implement it in an isolated worktree, run checks, and review the diff. The workflow stops for approval of the exact reviewed commit before pushing or opening a pull request.

Each computer is an independent installation. Clone this repository and your target project on the new machine, then follow the setup below. Projects, task history, credentials, and storage are local to that computer; no synchronization is required.

## Requirements

This guide targets **macOS**. Linux and Windows are not verified installation targets.

- **Node.js 26** (`.node-version`) and **pnpm 12.18.0** (`package.json`). [Node installation](https://nodejs.org/en/download).
- **Git**, with a commit name/email configured, and **GitHub CLI** (`gh`).
- **Docker with Compose**, supplied by Docker Desktop or OrbStack. Start its engine before setup.
- **Claude access**: a signed-in Claude Code installation, or an `ANTHROPIC_API_KEY` available to the backend process. [Claude setup](https://code.claude.com/docs/en/setup).

GitHub authentication must allow access to the target repository and, when requested, pushing a branch and creating a PR. Model calls use the active Claude account or API key and incur charges.

## 1. Install and authenticate

Install Node 26 and your Docker runtime first. With Homebrew available, the remaining tools can be installed with:

```sh
brew install git gh
brew install --cask claude-code
npm install -g pnpm@12.18.0
```

Verify the tools and authenticate on **this machine**:

```sh
node --version          # v26.x
pnpm --version          # 12.18.0
docker info             # must connect to the engine
docker compose version
gh auth login
gh auth setup-git
claude                  # complete sign-in, then exit the interactive session
```

For API-key authentication, supply `ANTHROPIC_API_KEY` securely in the terminal/environment used to start the backend. Do not put it in this repository. An agent should report an authentication step that needs the owner rather than inventing credentials.

Clone the factory and install it:

```sh
mkdir -p "$HOME/code"
git clone https://github.com/chepetime/factory-elections.git "$HOME/code/factory-elections"
cd "$HOME/code/factory-elections"

export PATH="$HOME/.local/bin:$PATH"
pnpm run setup
factory doctor
```

`pnpm run setup` installs locked dependencies, links `factory` into `~/.local/bin`, and runs the environment checks. Use `pnpm run setup`, not pnpm's unrelated `pnpm setup` command. Add the PATH export to your shell configuration for future terminals. If setup reports a failed check, resolve that check and rerun `factory doctor`.

The backend and CLI run TypeScript directly with Node. The web app builds when started with `pnpm web`.

## 2. Initialize local data storage

Run these commands from the **factory checkout**, before starting the backend:

```sh
export FACTORY_ROOT="$HOME/.local/share/factory"
mkdir -p "$FACTORY_ROOT"

pnpm data:up
pnpm data:migrate
pnpm data:status
```

`data:up` starts **Postgres and SeaweedFS/S3 only**, each with a persistent Docker volume. Next.js, the backend, workers, repositories, and worktrees stay on macOS.

`data:migrate` initializes and activates storage even on an empty installation. With existing file-based records it imports and verifies them, preserving their source files. With the same storage already active, it leaves current database state intact. It requires exclusive access during a first import, so stop the backend and any standalone task workers beforehand.

Two private configuration files are generated:

| File | Purpose |
| --- | --- |
| `.factory-data.env` in the factory checkout | Docker database/S3 credentials and host ports |
| `$FACTORY_ROOT/storage.json` | Backend/CLI connections to those services |

Keep these files on this machine. On another computer, generate new credentials and volumes through the same setup flow. Existing local volumes must continue using their original credentials. Use the same `FACTORY_ROOT` for all CLI and app commands; the default is the path shown above.

## 3. Register the target project

Clone the repository you want the factory to work on, or use an existing local checkout. Substitute its **absolute path** and a local project name:

```sh
export TARGET_REPO="/absolute/path/to/your/project"
export FACTORY_PROJECT="my-app"

git -C "$TARGET_REPO" remote get-url origin
git -C "$TARGET_REPO" status --short
git -C "$TARGET_REPO" config user.name
git -C "$TARGET_REPO" config user.email

factory project add --name "$FACTORY_PROJECT" --repo "$TARGET_REPO"
factory profile init --project "$FACTORY_PROJECT"
```

Project names contain only letters, numbers, hyphens, and underscores. The repository needs a GitHub `origin`, an existing local base branch, and a clean working tree before running a task. Configure a Git commit name/email if the checks above return empty values.

The last command prints the drafted profile path, normally `$FACTORY_ROOT/my-app/profile.yaml`. Review it against the target repository:

- `repo.base_branch.value` must name the branch to start from and target with PRs.
- `commands.test` must install dependencies with the repository's lockfile and run its tests in a fresh worktree.
- `commands.full_check` must run the remaining required checks.
- `confirmed.forbidden_paths` and `confirmed.forbidden_commands` define the coder's limits.
- Set `approved_at` to the review date as a quoted string, such as `'2026-11-17'`, after reviewing the profile.

For a pnpm repository, commands might be:

```yaml
commands:
  test: pnpm install --frozen-lockfile && pnpm run test
  full_check: pnpm run lint
```

Use the target project's actual commands. The profile draft is evidence-based but may need changes; placeholder or missing verification commands must be resolved before running work.

```sh
factory profile check --project "$FACTORY_PROJECT"
factory project list
factory task list --project "$FACTORY_PROJECT"
```

Profile validation should pass, the project should appear, and a new project's task list should be `[]`.

## 4. Start and verify

From the factory checkout, with Docker running:

```sh
pnpm data:up
pnpm web -- --dev
```

Open **http://localhost:3000**. Keep this terminal running. The launcher starts or reuses the authenticated backend. For production mode, use `pnpm web`, which builds the web app first.

In another terminal, verify the installation without spending model credits:

```sh
curl --fail http://127.0.0.1:4318/health
curl --fail http://localhost:3000/api/projects
```

Health should report `engine: running` and `task_store`, `telemetry_database`, and `artifact_store` as `available`. The project API and sidebar should show your registered project. The Settings page shows environment, profile, and storage checks. **Setup is complete at this point; a paid task is not required to verify it.**

Default ports:

| Service | Local address |
| --- | --- |
| Web app | `http://localhost:3000` |
| Backend gRPC | `127.0.0.1:4319` |
| Health | `http://127.0.0.1:4318/health` |
| Postgres | `127.0.0.1:15432` |
| S3 file storage | `http://127.0.0.1:18333` |

For backend-only use, run `pnpm backend` or `factory serve`. The web app calls the backend over gRPC; common CLI task actions also use it while it is running. REST currently exposes project/task lists and system status, not complete CRUD for every entity.

## Run work when requested

Use the web app's New task form, or:

```sh
TASK_ID=$(factory intake --project "$FACTORY_PROJECT" "Describe the requested change and its acceptance criteria")
factory task run --project "$FACTORY_PROJECT" --id "$TASK_ID"
factory task diff --project "$FACTORY_PROJECT" --id "$TASK_ID"
factory task gate --project "$FACTORY_PROJECT" --id "$TASK_ID"
```

After reviewing the diff, checks, findings, and drafted PR text, approve the actual head shown by the gate:

```sh
REVIEWED_HEAD="paste-the-reviewed-commit-sha"
factory task approve --project "$FACTORY_PROJECT" --id "$TASK_ID" --head "$REVIEWED_HEAD"
factory task open-pr --project "$FACTORY_PROJECT" --id "$TASK_ID" --draft
```

With the backend running, `factory task actions --project "$FACTORY_PROJECT" --id "$TASK_ID"` returns JSON action availability, blockers and required inputs.

For changes, use `factory task revise --project "$FACTORY_PROJECT" --id "$TASK_ID" --note "What to change"`. Use `factory --help` for the full command list. Opening a PR is a separate explicit action after approval.

## PR reviews and project settings

**PR Reviews** (project sidebar) lists the repository's open pull requests, ordered by what needs you first, like the `elections review` picker. Select one or more PRs to review. Each review is a chat with Claude Opus. It runs in a worktree at `<repo parent>/reviews/<repo>-<branch>` on the local branch `review/<branch>`. The backend appends the factory's copy of the skill (`definitions/skills/senior-pr-review/SKILL.md`) to the agent's system prompt. The agent saves its report as JSON, and the review screen shows it in the **Report** tab. Ask follow-ups in the chat, or ask the agent to act (for example, post the comments). **Re-review** resets the worktree to the latest head and continues the same chat. Reviews run with `--dangerously-skip-permissions`, like the CLI, and use model credits. Chat records are stored under `$FACTORY_ROOT/<project>/reviews/<PR>/`.

**Project settings** (project sidebar or project menu) holds the display name and icon, the task manager (kind, CLI, project key, command templates, usage docs and notes), and an optional senior-pr-review profile. **Fill from repository** runs a read-only Claude Sonnet agent in the repository to propose these fields (budget $2). Nothing is saved until you select **Save settings**. Review chats get the task-manager fields and the profile in their context.

## Restart, update, and recover

- **Later startup:** start Docker, enter the factory checkout, run `pnpm data:up`, then `pnpm web -- --dev` or `pnpm web`.
- **Stop apps:** Ctrl-C stops the launcher-owned web/backend processes. The backend drains accepted work, so shutdown may wait for an active run. A backend the launcher reused is left running.
- **Stop storage:** after the apps stop, `pnpm data:down` stops the services and preserves their volumes.
- **Update:** stop the apps, update this checkout, run `pnpm install --frozen-lockfile`, then start data services and apps again. Existing project registration and storage remain local.

| Problem | Action |
| --- | --- |
| `factory: command not found` | Add `~/.local/bin` to PATH or use `node bin/factory` from this checkout. |
| Backend/projects unavailable | Verify Docker with `docker info`, run `pnpm data:up`, and start the apps with `pnpm web -- --dev`. Confirm every process uses the same `FACTORY_ROOT`. |
| Port already occupied | Identify the existing listener. Reuse the correct installation or stop your old instance; do not start a second owner of the same data root. |
| Profile invalid | Review the printed profile path, actual commands, base branch, and `approved_at`; rerun `factory profile check`. |
| Ownership lock after an abrupt exit | Confirm the old process and its child workers stopped before removing a stale lock. See the recovery guide below. |
| A check needs downloads outside npm | The coder sandbox currently permits `registry.npmjs.org`. Additional hosts require an intentional sandbox change. |

Automatic recovery of interrupted steps, worktree cleanup, and rebasing are not implemented. Back up the database, artifact storage, host profiles, and repositories together as described in the storage guide.

## Development and reference

```sh
pnpm test          # scripted models; no paid calls; storage tests skipped
pnpm data:test     # real Postgres/S3 tests in isolated schemas; requires data:up
pnpm e2e           # production web build + seeded backend + Chromium; E2E_SKIP_BUILD=1 reuses .next
pnpm typecheck
pnpm lint
```

- [Docker storage, migration, and backups](docs/docker-storage.md)
- [Backend operation and interruption recovery](docs/local-backend.md)
- [State machines and agent action discovery](docs/state-machines.md)
- [Storybook](docs/storybook.md) for component development
