# Frontend data contracts — discovery

Status: working proposal, not an implemented HTTP API. The task file remains the authoritative task record; telemetry is a rebuildable cache. A UI component must not imply that its data or actions already exist.

The initial task record shape is [task-record.schema.json](../resources/task-record.schema.json); the local HTTP read surface is [task-read-api.openapi.yaml](../resources/task-read-api.openapi.yaml). The task-list CLI and HTTP endpoint are regenerating, with a task view queued. The endpoint calls a separately released factory CLI configured by `FACTORY_CLI_SCRIPT`; it is not a connection to the generated codebase.

## Initial contract candidates

| Frontend need | Data the backend must provide | Initial source and status |
|---|---|---|
| Task table, queue, inbox | Task and project identifiers, stage, timestamps and any pending human question | Task file; intake records only some of these fields today |
| Agent sequence, plan, graph | Named loop, ordered steps and gates, dependencies, and current state | Loop definition and task state; definition validation is being built, execution is not |
| Running now, monitor, fleet | Active task and step, start time, state and progress | Driver/run state; not implemented |
| Findings, approval card, steering | Findings, decisions, pending questions, allowed actions and recorded human answers | Task file; not implemented |
| Checkpoints, trail, recap | Durable checkpoint identities, step outcomes, timestamps and links to their evidence | Task and run records; checkpoint semantics are not yet decided |
| Cost and trace waterfalls | Per-step usage, timing, costs, currencies and parent/child relationships | Run records; not implemented; missing values remain unknown, never zero |
| Context window and map | Context usage and identified inputs or sources for each step | Run records; capture and limits are not yet decided |
| Tool access map | Effective tools and permission restrictions for the step | Profile plus step definition and execution record; not implemented |
| Conflict radar and plan vs actual | Explicit conflicts, expected work, observed work and their relationship | Not defined; component availability does not establish backend behavior |
| Model picker | Allowed ladder and current rung, with any human approval requirement | Model-ladder definition and task/run state; selection never bypasses policy |

## Boundaries to settle as features are built

- Define versioned, machine-readable request and response schemas before wiring a frontend view to the backend; share them across independently built frontend and backend modules.
- Separate reads from commands. A view reports which actions are available; commands validate the task's current state and safety rules on the backend.
- Specify each action's authorization, state transition, error response and concurrency behavior before enabling it. A checkpoint display does not imply rewind, and a plan display does not imply editable execution.
- Distinguish unavailable, pending and zero values. Preserve actual provider usage and currency rather than inventing estimates.
- Do not expose secrets, unrestricted filesystem paths, model context, tool inputs or untrusted agent output without an explicit disclosure and sanitization policy.
- Treat Workflow SDK durability as an open architectural evaluation: its event storage must not quietly become a competing task record.

## Visual references

Affect UI's App Shell Flat is the layout reference. Agent Checkpoints, Agent Findings, Agent Fleet, Agent Graph, Agent Inbox, Agent Monitor, Agent Plan, Agent Queue, Agent Recap, Agent Sequence, Agent Steering, Agent Trail, Approval Card, Chat Composer, Conflict Radar, Context Map, Context Window, Cost Waterfall, Model Picker, Plan vs Actual, Running Now, Thinking Loader, Tool Access Map and Trace Waterfall are candidate views. Their examples are design references, not approved behavior or proof of implemented functionality. The registry says the checked components require Affect UI Pro access.
