# Software Factory runtime

General domain language lives in [CONTEXT.md](CONTEXT.md). These terms distinguish workflow progress, current execution and available commands.

## Language

**Task stage**:
Durable progress recorded on a task, such as `coding` or `approved`; it does not prove a worker is alive.
_Avoid_: run status, execution phase

**Run**:
One accepted execution of a task's `run` or `revise` command, with its own identity, outcome and evidence.
_Avoid_: task, stage

**Execution phase**:
The observed combination of a run record and live backend ownership, including finalization, interruption and unavailable observation.
_Avoid_: task stage

**Action availability**:
An advisory view of whether a task command can be offered, its blockers and required inputs; execution still locks and rechecks.
_Avoid_: authorization, reservation

**Finalization**:
The interval while evidence is flushed and command ownership is released after the workflow outcome is recorded; the task remains busy.
_Avoid_: completed
