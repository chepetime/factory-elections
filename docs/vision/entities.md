# Entities

Part of the [product vision](../../VISION.md). The full model and its reasons are in [workspace-and-runtime.md §3](workspace-and-runtime.md#3-domain-model).

## The model

| Concept | What it is | Today in code | Change |
| --- | --- | --- | --- |
| Project | A durable context for a person, product or initiative | A repository (`Project` in `packages/core/src/schemas.ts` requires `repo`) | Add a kind (person, product, initiative). The repository becomes an optional resource |
| Task | A desired outcome or commitment: manual, assisted or delegated | One unit of repository work, with a coding stage | Primary project, related projects, accountable owner, current assignee, acceptance criteria, artifacts |
| Epic | A larger task with its own acceptance criteria | Feature (grill → spec → board) | A parent task. Done children do not prove the parent outcome |
| Plan | A revisable proposal for decomposition and order | The board step's tickets | Creating a plan is separate from executing it |
| Conversation | An interaction that builds understanding or moves work forward | Chats and PR review chats, tied to one task or PR | A first-class record. It can exist before a task and link to many tasks |
| Knowledge item | A fact, constraint or accepted decision that is current | Repository facts (`packages/core/src/memory.ts`) | Source, scope, validation status, timestamps and supersession links |
| History event | Something that occurred | Trace spans and task events | Kept even when its conclusion is replaced |
| Resource | A repository, document, external reference or connected service | The project's repo, Jira key, tool grants | A reference does not give execution access |
| Agent | A persistent collaborator configuration | Runtime definitions in `definitions/` | Identity and instructions stay separate from model and process |
| Skill | A reusable procedure | Skills in `definitions/skills/` | Usable across projects and agents |
| Workflow | Steps, handoffs and completion conditions | The coder loop in `packages/driver/src/workflow.ts` | The software workflow is one workflow, not the task model |
| Execution | One managed attempt to advance work | Run (see [GLOSSARY.md](../../GLOSSARY.md)), plus detached review turns | One execution manager for tasks, chats and reviews |
| Provider session | Provider-native conversation continuity | `sessionId` and `resume` in `packages/core/src/ports.ts` | Can span executions. It is never project memory or a Factory identity |
| Artifact | A concrete output: document, patch, report | Diffs, PRs, review payloads | Reviewable apart from the transcript |
| Attention item | A request for my action | Inbox item (`packages/core/src/inbox.ts`) | Resolving it does not approve the work |
| Squad | A reusable group with a coordinator | None | Only when recurring collaboration needs it |

[CONTEXT.md](../../CONTEXT.md) and [GLOSSARY.md](../../GLOSSARY.md) keep the terms that the code uses today. Update them when a phase changes the code.

## Rules

- A person project is about a person. It gives that person no account and no access. "My tasks" is a cross-project view. "José" is a project. They are not the same.
- People projects are ongoing. Do not show a person as "80% complete". Product and initiative progress attaches to goals or milestones.
- Task size and autonomy are independent. A small ticket can be fully delegated. A large epic can be collaborative.
- Task progress is separate from execution state. "In review" describes work. "Starting", "running" and "interrupted" describe an attempt. Workflow steps (grill, spec, coding) do not become universal task statuses.
- Comments and transcripts are evidence. They become knowledge only through promotion: finding → proposed knowledge → confirmation where needed → current knowledge.

## Where the earlier entities go

| Earlier entity | Becomes |
| --- | --- |
| Project (codebase) | Product project with a repository resource |
| Team member | A person project; identities stay as resources |
| Ticket, PR | Resources and artifacts linked to a task |
| PR review | An artifact of a review execution |
| Feature | Epic |
| Run, span | Execution and its event journal |
| Gate | An attention item that asks for approval |
| Tool grant | Part of the effective configuration and permissions |

The earlier open questions (ticket vs task, feature vs epic, human PR reviews, a team above members) are answered by this table.

## Open questions

From [workspace-and-runtime.md §16](workspace-and-runtime.md#16-decisions-still-open). They do not block phases 0–4. Answer them before phase 5 widens access or automation defaults.

- [ ] Is Factory single-user first, with people as projects, or collaborative now?
- [ ] Which actions run without review, per project and workflow?
- [ ] How are person-project notes shared when that person becomes a workspace member?
- [ ] Which local skills and integrations does an execution inherit by default?
- [ ] How long do provider sessions, raw events and artifacts stay?
- [ ] Remote execution soon, or local first?
- [ ] When does a conversation create a task, and when does it only propose one?
- [ ] What is the smallest useful set of agents, and when is a squad justified?
