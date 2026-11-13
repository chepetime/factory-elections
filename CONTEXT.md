# Software Factory

A factory that turns work requested for a repository into a reviewed change.

## Language

**Project**:
A repository registered with the factory and its associated tasks.
_Avoid_: workspace, effort

**Task**:
A unit of work requested for one repository.
_Avoid_: job, ticket

**Task file**:
The authoritative record of one task.
_Avoid_: hub item, mirror

**Intake id**:
The identifier assigned to a task when it is submitted.
_Avoid_: temporary id

**Stage**:
Where a task is in its run.
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
