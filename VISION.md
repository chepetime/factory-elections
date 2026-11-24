# Product vision

> Factory is a workspace for organizing and doing my work with agents. Tasks express commitments, projects preserve the context around people, products and initiatives, and conversations help turn intentions into results. I can choose how much to direct and how much to delegate.

The task is the central object. Software development is one important workflow. The same workspace also supports management, research, planning and writing, without a repository.

The main screen answers three questions:

- **What needs me?**
- **What is progressing?**
- **What can I review?**

**Headline metric:** my minutes of attention per accepted outcome, with quality and rework beside it. Tokens and cost help to find causes. They do not show value on their own.

## Principles

1. **Start with the work.** I can capture a task before I choose an agent, a workflow or an environment.
2. **Context belongs to its scope.** Project facts are available to the agents that need them. Each agent does not keep its own copy.
3. **Collaboration and delegation coexist.** In one task I can take part, clarify, review or delegate.
4. **Progress requires evidence.** A successful provider turn does not complete a task.
5. **Execution is observable and controllable.** Start, steer, interrupt and resume each have one exact meaning.
6. **Capabilities are explicit.** The app shows the tools, instructions and permissions that an execution actually gets.
7. **History stays; current knowledge changes.** A replaced decision stays explainable, but it is no longer an active instruction.

## How it runs

The app runs locally, on one machine, in three parts:

- **Server.** The backend owns every execution and holds all the data. One execution manager runs tasks, chats and reviews.
- **Web app.** Inbox, Tasks, Projects and Conversations first. Agents and execution details are working tools. Skills, integrations and runtime settings are configuration.
- **CLI.** Commands to start and drive work from the terminal.

## The vision in detail

| Document | Contents |
| --- | --- |
| [docs/vision/workspace-and-runtime.md](docs/vision/workspace-and-runtime.md) | The full design draft (24 Nov 2026): vision, domain model, execution manager, provider adapters, lifecycle, migration and acceptance tests |
| [docs/vision/entities.md](docs/vision/entities.md) | The domain model, how it maps to the code today, open questions |
| [docs/vision/roadmap.md](docs/vision/roadmap.md) | The build phases, their exit criteria, and where the earlier steps go |
| [docs/vision/ui.md](docs/vision/ui.md) | The board, the card and the shell: the UI direction |
| [docs/vision/workflow.md](docs/vision/workflow.md) | The software workflow: six stages, the flow rules, PR tending |
| [docs/vision/control.md](docs/vision/control.md) | Many agents, one control point, factory controls, tools per project |
| [docs/vision/tools-and-reviews.md](docs/vision/tools-and-reviews.md) | Tool needs by stage, the tool broker, automated PR reviews |
| [docs/vision/models-and-costs.md](docs/vision/models-and-costs.md) | The model router, cost tracing, where the savings are |
| [docs/vision/tracing-and-metrics.md](docs/vision/tracing-and-metrics.md) | Spans, the team baseline, the metrics |

## Build order

Reliable execution comes first, because every workflow and every degree of delegation runs on it. The product then grows past repositories. The status is on 24 Nov 2026; [docs/vision/roadmap.md](docs/vision/roadmap.md) has the details.

| Phase | Work | Status |
| --- | --- | --- |
| 0 | Baseline: pinned versions, protocol fixtures, lifecycle checks | Mostly done ([baseline](docs/runtime-baseline.md)) |
| 1 | Shared execution contract across adapters | Done ([ADR 0005](docs/adr/0005-execution-contract.md)); deferred parts move to phases 2–4 |
| 2 | Codex app-server prototype | Done behind `FACTORY_CODEX_TRANSPORT=app-server`; user config isolation open |
| 3 | Claude consolidation: reviews and chats on the managed SDK path | Done; restart behavior of review turns open |
| 4 | Durable operations: manifests, recovery, shared limits, usage checkpoints | Started: call manifests, signed evidence receipts, test-weakening gate, review drain |
| 5 | Product generalization: optional repositories, person projects, conversations, knowledge | Not started |
| Later | Warm pools, remote runtimes, squads, advanced autonomy, and the open earlier steps 5–10 | Paused |

The earlier build order (trace model, paid runs, counts, inbox, tending) is done or mostly done. Its open steps are on the roadmap under "Later".
