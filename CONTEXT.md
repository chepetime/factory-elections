# Harbor Lighthouse

A factory that turns work requested for a repository into a reviewed change.

## Language

**Project**:
A repository registered with the factory and its associated tasks.
_Avoid_: workspace, effort

**Task**:
A unit of work requested for one repository.
_Avoid_: job, ticket

**Task file**:
The authoritative record of one task: JSON in file mode, validated JSONB in configured Postgres storage.
_Avoid_: hub item, mirror

**Intake id**:
The identifier assigned to a task when it is submitted.
_Avoid_: temporary id

**Stage**:
Durable workflow progress on a task, independent of live run ownership.
_Avoid_: phase, status

**Profile**:
The approved settings and safety limits for work in one repository.
_Avoid_: config, settings

**Step**:
One bounded model call made while working a task.
_Avoid_: turn, phase

**Loop**:
The named, ordered path of steps and gates a task follows.
_Avoid_: route, pipeline

**Rung**:
A model and reasoning effort in an ordered ladder.
_Avoid_: level, tier

**Verdict**:
The classifier's facts about a task, including its kind, level of effort, readiness and blockers; it does not select a loop.
_Avoid_: decision, route

**Blocker**:
A research, clarification or slicing reason a task is not ready, with its question.
_Avoid_: issue

**Worktree**:
The task's own git working directory and `factory/<id>` branch, where the coder works and checks run.
_Avoid_: sandbox, checkout

**Approval**:
A human's recorded decision to open a pull request for one exact reviewed commit.
_Avoid_: sign-off, merge

**Revision**:
A human request for changes that sends an awaiting task back through coder, verification and review.
_Avoid_: retry, rework

**PR review**:
A chat with the senior-pr-review agent about one open pull request, in its own review worktree; its report is the payload the agent saves.
_Avoid_: review task, review job

**Project settings**:
A project's display name, icon, task manager and review profile; editable, unlike the project id.
_Avoid_: profile (that is the approved repository profile), config

See [runtime terminology](GLOSSARY.md) for run, execution phase, action availability and finalization.
