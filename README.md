# factory-elections

A personal software factory that runs on your Mac. You give it a task for a git repository. It classifies the task, writes the change in an isolated git worktree, runs the repository's checks, and has a second model review the diff. Then it **stops and waits for you**. Nothing is pushed and no pull request is opened until you approve the exact commit you reviewed.

```
intake → classify → worktree → code → verify ─┬→ review → YOUR APPROVAL → push + pull request
                       │                  ↑    │
                       └ unclear: stops   └────┘ verification failed: retry on a stronger model
```

It is a command-line tool (`factory`). It descends from the ideas in the sibling `devin-factory` repository; see [the feature inventory](docs/feature-inventory.md) for the long-term plan.

## Requirements

- macOS (tested on macOS 27; Linux should work but is untested)
- Node.js 26 or later (26.13.1 LTS tested), and pnpm 12 (the repository pins pnpm 12.18.0 in `packageManager`)
- git
- GitHub CLI (`gh`), signed in to an account that can push to your repositories and open pull requests
- Access to Claude models: either a signed-in Claude Code installation (`claude`), or an `ANTHROPIC_API_KEY`

Model calls are billed to whichever Claude account or API key is active. A small task costs roughly $0.10–$0.50 with the default ladders.

## Install

```sh
# Prerequisites, if you don't have them (pick your own Node manager if you prefer)
brew install node pnpm gh git
gh auth login
claude            # sign in once, or: export ANTHROPIC_API_KEY=...

# The factory
git clone <this repository> factory-elections
cd factory-elections
pnpm run setup
```

`pnpm run setup` (or `npm run setup`) does three things. It installs dependencies, links `factory` into `~/.local/bin` (set `FACTORY_BIN_DIR` to use another directory), and runs `factory doctor`. If that directory isn't on your `PATH`, it prints the line to add to `~/.zshrc`. It's safe to rerun. Note that `pnpm setup` without `run` is pnpm's own built-in command, so it won't run this script.

`doctor` checks Node, git, the GitHub CLI sign-in, Claude access and the data directory, and tells you how to fix anything that fails.

There is no build step. Node runs the TypeScript sources directly. After `git pull`, run `pnpm install` again.

## Configure a repository

The factory works on **registered projects**. Each project has a **profile** that you approve. The profile holds the commands that verify a change and the paths and commands the coder must never touch.

```sh
factory project add --name myapp --repo /Users/me/code/myapp
factory profile init --project myapp      # prints the path of a drafted profile.yaml
```

Open the drafted file (by default `~/.local/share/factory/myapp/profile.yaml`), check every value, then set `approved_at`:

```yaml
project: myapp
approved_at: '2026-11-13' # the factory refuses to work until this is set
repo:
  base_branch:
    value: main # PRs target this branch; worktrees start from it
    source: origin/HEAD
commands:
  test: pnpm install --frozen-lockfile && pnpm run test # runs first, in the task worktree
  full_check: pnpm run lint # runs second
confirmed:
  forbidden_paths: [.env, .github/workflows/, infra/] # exact path, "dir/" prefix, or * glob
  forbidden_commands: [terraform apply, npm publish] # substrings the coder may not run
design_sources: []
qa_targets: []
```

```sh
factory profile check --project myapp     # "Profile valid: myapp"
```

Both commands run with `/bin/sh -c` in a fresh worktree, so `test` must install dependencies first. Verification fails if the commands leave uncommitted, non-ignored files, so use lockfile-respecting installs.

The repository needs a GitHub `origin` remote, and the local base branch must exist. The working tree must be clean when a task starts: the factory never touches your checkout, but it creates the task branch from it.

### Where data lives

| What                         | Where                                                                       |
| ---------------------------- | --------------------------------------------------------------------------- |
| Data root                    | `$FACTORY_ROOT`, default `~/.local/share/factory`                           |
| Project record               | `<root>/<project>/project.json`                                             |
| Profile                      | `<root>/<project>/profile.yaml`                                             |
| Task record (the one source) | `<root>/<project>/tasks/<id>/task.json`                                     |
| Task worktree                | `<root>/<project>/worktrees/<id>` on branch `factory/<id>`                  |
| Models, prompts, loop        | `definitions/` in this repository (edit the YAML and prompts to tune steps) |

## Run a task

```sh
ID=$(factory intake --project myapp "Add a --verbose flag to the export command, with a test.")
factory task run --project myapp --id "$ID"
```

`task run` does every automated step and prints the approval gate:

```
Task 71d452ef-… — stage: awaiting-approval
Branch factory/71d452ef-… → main, head 7f4fed4364a3
 src/export.ts      | 12 ++++++++++--
 src/export.test.ts | 18 ++++++++++++++++++
Verification: passed at 7f4fed4364a3
Review (7f4fed4364a3): approve — Adds the flag and a test …
  [nit] src/export.ts: …
Model attempts: 3, estimated cost: $0.27

Next, after reading `factory task diff`:
  approve:  factory task approve --project myapp --id 71d452ef-… --head 7f4fed4364a3
  revise:   factory task revise --project myapp --id 71d452ef-… --note "<what to change>"
  reject:   factory task reject --project myapp --id 71d452ef-… --note "<why>"
```

Read the change with `factory task diff …`, or open the worktree in your editor. Then choose one:

```sh
factory task revise  --project myapp --id "$ID" --note "Also document the flag in README"   # coder → verify → review again
factory task approve --project myapp --id "$ID" --head 7f4fed4364a3 [--note "..."]
factory task open-pr --project myapp --id "$ID" [--draft]    # pushes factory/<id> and prints the PR URL
```

`approve` needs the commit you reviewed (`--head`). If anything changes after you look, approval is refused and you review again. `open-pr` re-checks every gate before pushing.

If the classifier finds the task unclear, too large for one PR, or in need of research, `task run` stops before writing any code. It exits with status 3 and prints the questions; submit a clearer task.

## Web app

```sh
pnpm web          # builds, then serves http://127.0.0.1:4317 and the health API on :4318
pnpm web -- --dev # development mode with hot reload, no build step
```

Open <http://127.0.0.1:4317>. Ctrl-C stops both servers. The app reads and acts only through the `factory` CLI and keeps no state of its own, so the CLI and the web app always agree. It uses the same data root (`FACTORY_ROOT`), so `FACTORY_ROOT=/tmp/factory-demo pnpm web` shows the demo data.

### Component library and Storybook

The in-app gallery is at `/components`. It includes the free affectUI catalog and the original factory components.

```sh
pnpm storybook        # isolated component workshop at http://127.0.0.1:6006
pnpm storybook:build  # static build in apps/web/storybook-static
pnpm storybook:test   # browser interaction and accessibility checks, light and dark
```

For a fresh checkout, run `pnpm --filter @factory/web exec playwright install chromium` before the browser tests. Regular `pnpm test` keeps running the unit/CLI suite without launching a browser.

See [Storybook workflow](docs/storybook.md), [component patterns](docs/frontend-component-patterns.md), and the [MIT source inventory](resources/affect-ui-free-components.json).


- **Home:** your projects, engine health, and placeholders for planned views.
- **Project page:** submit a task (by default it starts the run straight away) and see every task with its stage, readiness and blockers.
- **Task page:**
  - the diff, verification output, review findings, model attempts with cost, and the timeline;
  - **Approve**, which sends the exact commit shown on the page;
  - **Revise** with a note, **Reject**, and **Open pull request** (draft by default).
  - Runs and revisions continue in the background. The page shows their log and refreshes until they finish.

The app accepts requests only for `127.0.0.1` or `localhost`, and accepts form submissions only from its own pages. Every action runs the same CLI command you would type, so the approval rules are identical.

## What works today

| Area                | Status                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intake and records  | Works. `intake`, `task show`, `task list`; one JSON task file holds stage, verdict, attempts, costs, verification, review, approval, PR and an event timeline.                                                                         |
| Projects, profiles  | Works. `project add/list`, `profile init/check`. You approve profiles by editing `approved_at`.                                                                                                                                         |
| Classification      | Works (Claude Haiku). States kind, size, readiness and blockers. Blocked tasks stop before any code.                                                                                                                                    |
| Coding              | Works (Claude Sonnet, climbing to Opus). Runs in its own worktree and branch. The factory commits; the coder cannot push, use `gh`, switch branches, run forbidden commands, edit forbidden paths, or use files outside the worktree. |
| Verification        | Works. Runs the profile's `test` and `full_check`. Failures feed the output to the next, stronger attempt (default up to 3 attempts).                                                                                                    |
| Review              | Works (Claude Sonnet, read-only). Findings are graded blocking, major, minor or nit. Blocking findings need `--accept-blocking` to approve.                                                                                              |
| Human gate          | Works. `gate`, `diff`, `approve`, `revise`, `reject`. Approval is bound to the reviewed commit.                                                                                                                                        |
| Pull request        | Works through `gh pr create`, after approval only. The PR body is built from the task record.                                                                                                                                         |
| Health API          | `factory serve` serves `GET http://127.0.0.1:4318/health`.                                                                                                                                                                             |
| Definition checks   | `definition check-step/check-ladder/check-loop`, `verdict check`, `classifier run`, and the individual step commands in `factory --help`.                                                                                             |
| Web app             | Works locally (`pnpm web`). Projects, tasks, task detail with diff, verification, review, cost and timeline; submit, run, revise, approve, reject and open PR. Placeholder cards remain for planned views.                          |
| Everything else     | Not built: dispatcher/queue, PR tending, slicing, research route, QA step, telemetry store, retros, inbox. See [the feature inventory](docs/feature-inventory.md).                                                                             |

## Limitations

- **One task at a time, on demand.** There is no queue or background service. `task run` runs in the foreground and takes minutes.
- **Shell sandboxing is a first guardrail.** The coder's Bash calls are screened for forbidden command substrings, and they run in the Agent SDK's macOS sandbox. Commands can write only inside the worktree and the pnpm/npm caches, and can reach only `registry.npmjs.org`. They can still *read* most of your home directory. Commands that need other hosts (other registries, `git fetch`, downloads) fail inside the sandbox; widen `sandboxFor` in `packages/adapters-claude` if a repository needs them. If the sandbox can't start, the coder step fails instead of running unsandboxed. Use the factory only on repositories and prompts you trust.
- **No break-glass rung yet.** The Fable rung in `definitions/ladders/coder.yaml` is marked `requires_human_approval`, and nothing in the CLI grants that approval yet, so it is never used.
- **The PR body is generated from the task record**, not written by a model.
- **Worktrees and branches are not cleaned up.** Remove them yourself when a task is finished (see Troubleshooting).
- **Costs are estimates** reported by the Agent SDK. "unknown" means the SDK reported none; it is not zero.
- **No resume of an interrupted step.** If `task run` is killed while coding, the task stays in `coding`. Use `task revise` to try again on the same worktree.
- Rebasing onto a moved base branch is not automatic. The PR shows conflicts, and you resolve them yourself.

## Troubleshooting

| Symptom                                                                    | Fix                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor` says Claude is not signed in                                      | Run `claude` and sign in, or `export ANTHROPIC_API_KEY=…` in the shell that runs `factory`.                                                                                                        |
| `model run failed: …` (authentication, rate limit, overloaded)            | Check `claude auth status`, wait, then `factory task revise … --note "retry"` (if a worktree exists) or rerun `task run`.                                                                         |
| `invalid profile: approved_at: …`                                          | Review `profile.yaml` and set `approved_at` to a date string.                                                                                                                                       |
| `task repository has uncommitted changes`                                  | Commit or stash in your own checkout. The factory needs a clean repository to branch from.                                                                                                          |
| `worktree path already exists` / `branch already exists`                   | A previous attempt left them. Remove both (below) or submit a new task.                                                                                                                             |
| `the change commits generated files: …`                                     | The coder committed build output or caches (`*.tsbuildinfo`, `.next/`, `node_modules/`, `coverage/`, `.DS_Store`, …). Add them to the repository's `.gitignore` and revise the task so it removes them from the change.                       |
| `verification left uncommitted changes: …`                                 | Your test command writes files git doesn't ignore (lockfiles, build output). Use `npm ci` / `pnpm install --frozen-lockfile`, or add the outputs to `.gitignore`.                                  |
| `verification still failing after N coder attempt(s)`                      | Read `factory task show … ` (`verification.output_tail`). Fix the profile commands if they are wrong, or `task revise` with guidance.                                                              |
| `cannot approve: … older commit` or `--head must be …`                     | The branch changed after you looked. Run `factory task gate …` and approve the head it shows.                                                                                                     |
| `gh pr create failed: … known GitHub host`                                 | `origin` must point at GitHub, and `gh auth status` must succeed. Fix it, then rerun `task open-pr`. The task stays `approved`, and pushing again is safe.                                         |
| `node: … ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` or similar                     | Node is older than 26. Check `node --version`.                                                                                                                                                      |
| `Cannot find package '@factory/…'` or `'zod'`                              | Run `pnpm install` in the repository.                                                                                                                                                               |
| Web page says `Engine unavailable`                                         | Start the app with `pnpm web`, which also runs `factory serve`, or run `factory serve` yourself.                                                                                                    |
| Web page says `Projects unavailable` or `Tasks unavailable`               | Check that `factory project list` works in a terminal. If you start Next.js yourself, set `FACTORY_CLI_SCRIPT` to the absolute path of `bin/factory`.                                               |
| `Forbidden` (403) in the browser                                           | Open `http://127.0.0.1:4317` or `http://localhost:4317`. Other host names are refused on purpose.                                                                                                   |
| `EADDRINUSE` on 4317                                                       | Another copy is running. Stop it, or find it with `lsof -i :4317`.                                                                                                                                  |

To clean up a finished task's worktree and branch (run in your repository):

```sh
git worktree remove ~/.local/share/factory/<project>/worktrees/<id>
git branch -D factory/<id>
```

## Development

```sh
pnpm test           # CLI tests (scripted model, temp git repos, fake GitHub) and web tests (fake CLI); no network or model calls
pnpm check          # prettier, oxlint (warnings denied), tsc, tests
```

| Path                       | Contents                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/core`            | Pure domain: schemas, readiness, gates, PR text. Lint forbids I/O imports.                   |
| `packages/adapters-*`      | Filesystem store, git, GitHub CLI, process spawning, Claude Agent SDK runner.                |
| `packages/driver`          | The workflow (classify → … → open PR) over injected ports.                                   |
| `apps/cli`                 | `factory` command, `serve`, `doctor`, profile drafting.                                      |
| `apps/web`                 | Next.js web app (App Router, shadcn/ui) over the CLI; `pnpm web` starts it.                  |
| `definitions/`             | Step, ladder and loop YAML and step prompts.                                                 |
| `factory.plain`            | Specification of the CLI behaviour; `frontend.plain` specifies the web app.        |
| `resources/`               | JSON Schema and OpenAPI contracts referenced by the specs.                                   |
| `docs/adr/`                | Decisions. [ADR 0002](docs/adr/0002-hand-written-v1.md) explains why v1 is hand-written.     |

The `.plain` files are the specification. Change them along with the code. They were written for the turri renderer, which is not available on this machine. `test_scripts/` and `scripts/setup-agent-env.mjs` are turri pulse helpers and aren't needed to run or test the factory. See [the handoff](docs/HANDOFF.md) for project status.
