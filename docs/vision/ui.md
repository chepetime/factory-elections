# UI direction

Part of the [product vision](../../VISION.md). A screenshot of a simple board UI (shared on 24 Nov 2026) is the visual reference. It is a reference for layout and density only: do not copy its name, logo, mascot or exact look.

## The board

One board answers the three questions on one screen. Its columns are task progress, not execution state ([entities.md](entities.md#rules)):

| Column | Question | A task is here when | Data today |
| --- | --- | --- | --- |
| Working | What is progressing? | An execution runs for it | Run `phase` (`queued`, `running`, `finalizing`) |
| Needs me | What needs me? | An attention item is open | `GetInbox` items |
| In review | What can I review? | An artifact waits for review, or its PR waits for people or checks | Stage `awaiting-approval`, open PR, review state |
| Ready | What can I finish? | It is approved and its PR can merge | Approval, PR checks |

A column shows its count. Done and archived tasks leave the board; one line at the bottom shows how many are archived.

## The card

- Title: the task name (`taskTitle`), at most two lines.
- One resource line: the branch or other resource, with its icon.
- The PR number and the people on it, when there is a PR.
- One live line with its age: the latest meaningful event ("Editing file", "13/42 checks passed", "Input needed", "Approved"). Use execution events, never log noise. This follows principle 4: progress needs evidence.
- One primary action, only when it is the next step (for example, Merge when the PR is ready). Resolving an attention item does not approve the work.

## The shell

- The left sidebar has Search, then Projects, with each project's active tasks under it and a state icon for each. Person, product and initiative projects (phase 5) use the same list.
- The top bar has the current view and one "New task" button.
- Agents, skills, integrations and runtime settings are not in the main navigation ([workspace-and-runtime.md §5](workspace-and-runtime.md#navigation)).
- Dark, dense and calm: few colors, and color only for state (blue working, orange needs me, yellow in review, green ready).

## Order

1. A board page over the data that exists now (tasks, runs, inbox, reviews), for repository projects. It replaces the separate task, inbox and review lists as the home page.
2. The sidebar with projects and their active tasks.
3. Phase 5 adds non-repository projects and conversations. The board stays the same, because its columns are task progress, not code stages.
