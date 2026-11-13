# Project handoff

## Goal

Deliver a version that can be cloned and run locally on macOS and takes a task from intake through classification, coding, verification, review, human approval and pull request creation. Document installation, configuration, available features and limitations before calling the version ready.

## Source of truth

`factory.plain` describes the backend CLI and `frontend.plain` describes the web interface. Files linked under `resources/` are part of those descriptions. Regenerate code from the relevant `.plain` file rather than editing generated files. `config.turri.yaml` and `config.turri.frontend.yaml` configure the project and frontend stack.

`plain_modules/`, `dist/` and `.turri/` are ignored by Git. A clone does not contain the generated application, a release, local regeneration records or a chat transcript. The project does not yet define a verified way to install and run the application from a fresh clone.

## Current scope

The backend `.plain` covers task intake and records, configuration validation, classification, health, project registration and project listing. It also describes creating an isolated worktree for a ready task. The frontend `.plain` describes a local interface and project and task views. A functional spec's presence does not mean its code has landed: inspect module drift and pulse results before relying on it.

The full coder, verification, reviewer, human approval and pull-request workflow is not yet complete. The feature inventory in `README.md` includes plans as well as implemented capabilities; it is not a list of features ready to use.

## Continuation

1. Install turri and the Node and pnpm toolchains on the new Mac, and sign in to the required model provider through turri. The project's implementation requirements name Node.js 26 or later. Follow `README.md` for the existing local agent setup; that setup has not yet been verified as a complete installation guide.
2. Open the repository in turri and check drift for both `factory.plain` and `frontend.plain`. Inspect any failed pulses and the current testing scripts before retrying.
3. Continue the task-to-PR loop in small, ordered functional specs. Keep the human approval gate before pushing or opening a pull request.
4. Establish a reproducible clone-to-running-app workflow, then write and verify installation, configuration, feature and troubleshooting documentation on a clean Mac checkout.

## Known build issue

Recent backend and frontend pulses exceeded the 120-second unit-test command limit during isolated dependency installation or cleanup. One backend run passed static checks and all 27 tests before timing out during cleanup; the pulse was rolled back. Work to adapt the backend unit-test script was started separately. Check its outcome and the current pulse state rather than assuming the issue is fixed.

Do not put credentials, local task data or machine-specific paths into the repository. A fresh machine needs its own provider authentication and any project-specific configuration.
