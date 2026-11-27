# Client data layer and attention states (2026-11-27)

Reported in use: switching chats is slow; after **Approve** no other screen opens until it finishes, and the same happens after most actions; a task opened in a new tab showed the task but no projects; lists refresh slowly; and "Needs you" means different things in different places. This assessment traces each report to the code and proposes a fix order. Timings were not measured against real data yet; step 0 of the plan does that.

## Findings

### 1. Actions hold the screen for the whole operation

Next.js runs server actions and navigations through one queue: while an action is pending, a click on a link waits behind it. `approveAndOpenPullRequest` (`apps/web/src/app/actions.ts:165`) awaits the approval and then `open-pr` with a 300 s deadline, which pushes the branch and calls GitHub, so the whole app is frozen for that long. The same applies to every action that awaits slow backend work (`approveTask`, `openPullRequest`, `rejectTask`, `createReviewTicket`, `detectProjectSettings`, `draftProfile`).

The backend already has the right shape for some of them: `startTask` accepts a run and returns. The slow ones use `executeTask`, which waits for the result.

### 2. Actions refresh far more than they changed

- `revalidatePath('/', 'layout')` (`addProject`, `saveProjectSettings`, `dismissInboxItem`) re-renders every server component of the current page, including the root layout's `userSettings()` call.
- `revalidatePath('/projects/<p>/tasks', 'layout')` follows most task actions.
- 15 components call `router.refresh()`, which re-runs every loader of the current route.

No action updates the screen before the server answers: there is no `useOptimistic` anywhere, so every click waits for a round trip and a full re-render.

### 3. Pages load in sequential waterfalls, and repeat reads

The task page (`apps/web/src/app/projects/[project]/tasks/[id]/page.tsx`) awaits about eight reads one after the other: `getIssue` (twice, plus once more in `generateMetadata`), `listAgents` (twice), the run render, `userSettings` (already read by the root layout), then the session or diff, then review detail, then the review loop. The chat page reads `GetChat` twice (`generateMetadata` and the page). Only `projectLabel` is wrapped in React `cache()`, so nothing is shared within one request.

Only the board, tickets and user pages have a `loading.tsx`. Switching chats, tasks or reviews shows nothing until the server finishes, which feels slower than it is.

### 4. The backend answers every read by reloading the project, one request at a time

`IssueStore` (`packages/backend/src/issues.ts`) runs `list`, `get` and every write under one semaphore with one permit, shared by **all projects**. Each call runs `sync()`: it reads the board and every task record of the project (`SELECT data FROM factory_tasks WHERE project=$1`, the full JSON of each), then links unlinked runs. So:

- `GetIssue` for one task costs the same as listing all of them, and some paths then call `tasks.list` again to find one run (`issues.ts:460`, `:496`).
- The sidebar poll (every 10 s), the inbox notifier (every 15 s, which calls `ListIssues` for every project in the inbox through `withTaskKeys`), the page loaders and the actions all wait in the same queue. One slow write delays every read in every tab.

### 5. Polling asks for everything

- The sidebar fetches `/api/projects` on every navigation and `/api/projects/<p>/issues` on every navigation and every 10 s, the full summary list each time.
- The inbox notifier polls `/api/inbox` every 15 s, with the cost from finding 4.
- `run-session` polls every 1.5 s and `system-network` every 5 s while open.

Nothing asks "what changed since version N", so each poll pays for the whole list even when nothing changed.

### 6. A new tab can show no projects

`useProjects` (`apps/web/src/components/app-shell.tsx:113`) fetches `/api/projects` once per path. On failure it shows "Projects unavailable" and only tries again on the next navigation. A fresh tab on a task page sends its page loaders and the sidebar requests at once; with finding 4's queue and the RPC client's 10 s deadline, the project request can fail while the page itself renders. Nothing retries it.

### 7. "Needs you" puts five different things in one bucket

`runAttention` (`packages/core/src/run-attention.ts`) maps these to `needs-you`:

| Stage | What the person does | Kind |
| --- | --- | --- |
| `awaiting-approval` | Review the change, approve or revise | Decision |
| `approved` | Open the pull request | Decision |
| `blocked` | Answer the agent's question | Answer |
| `failed`, `verification-failed` | Read the error, revise or retry | Problem |
| coding or reviewing with no live run | Start it again | Problem |

The sidebar shows all of them under one red **Needs you** heading (`sidebar-work.tsx:31`), the task page uses a "needs you" banner for both "open the PR" and "blocked" (`task-run.tsx:799`, `:831`), and the home and dashboard count them as one number. A routine review request and a crash look equally alarming, so the label stops meaning anything.

## Proposal

### Attention states

Split `needs-you` into three, in `runAttention` so every screen follows:

| State | Stages | Label | Tone |
| --- | --- | --- | --- |
| `decide` | `awaiting-approval`, `approved` | To review | Neutral (blue) |
| `answer` | `blocked` | Question | Amber |
| `fix` | `failed`, `verification-failed`, interrupted | Problem | Red |

Counts on home and dashboard become "3 to review · 1 problem". Red is then reserved for something that went wrong.

### Data layer

1. **Accept, then work (finding 1).** Slow actions return as soon as the backend accepts them, like `startTask`: approve and open-pr become backend runs, and the page follows their progress through the existing live-run poll. No action awaits GitHub or git.
2. **Optimistic updates (finding 2).** Board moves, status, assignee, archive, approve and comment update local state with `useOptimistic` and roll back with a toast on error. Each action revalidates only what it changed, never `('/', 'layout')`.
3. **Parallel, shared reads (finding 3).** Wrap the read helpers (`getIssue`, `listAgents`, `userSettings`, `getChat`) in `cache()`, start every independent read together, and stream the slow panels (diff, session, review loop) behind `Suspense`. Add `loading.tsx` to chat, task and review routes so a click shows the new screen at once.
4. **Cheap reads in the backend (finding 4).** Reads stop taking the write lock; the lock becomes one per project; `get` reads one board item and its runs; `sync` (linking new runs) runs once on write or on a run event, not on every read; the task list query selects the summary columns instead of the full JSON.
5. **Version-gated polling (finding 5).** The backend keeps a change counter per project (bumped by every issue or run write). `GET /api/projects/<p>/version` returns it; the sidebar, inbox and pages fetch the full list only when it moved. Later, one server-sent event stream can replace the timers.
6. **Retry the shell's reads (finding 6).** `useProjects` retries with backoff and refetches on focus; the project list is small and changes rarely, so it can also come from the server layout as initial data.

### Order

0. Measure: time each RPC and each page against real data (backend spans already record RPC duration), so every step shows its gain.
1. Attention states (one rule, every screen) and the new-tab retry: small, visible.
2. Accept-then-work for approve and open-pr: removes the frozen screen.
3. `cache()`, parallel reads and `loading.tsx`: makes navigation feel instant.
4. Backend lock and read cost: the main server-side gain.
5. Optimistic updates, then version-gated polling.

Update `docs/state-machines/task-stages.md` and `ui.md` with step 1, and `approval-and-publication.md` with step 2.

## Status (2026-11-27)

| Step | State |
| --- | --- |
| 0. Measure against real data | Open: needs the live stack. |
| 1. Attention states, new-tab retry | Done (`a101732`): `review`, `reply`, `problem` with their own labels and tones on the sidebar, task cards, stage pills, inbox dots and home cards; the project list retries with backoff. |
| 2. Accept, then work | Done (`a1eefbc`), by a smaller route than proposed: approve, open-PR and reject post to a route handler with `fetch`, so navigation is never queued behind them, and a toast reports the result on any page. The backend still runs them in one request. |
| 3. Shared, parallel reads; loaders | Done (`e8364ae`): read helpers are `cache()`d per render, the task page loads in two parallel rounds, and chats, tasks and reviews show a loader at once. |
| 4. Backend read cost | Done (`3f6f8b1`): reads take no lock, one lock per project, and one task reads only its latest run. The full task list still selects whole records. |
| 5. Optimistic updates | Done for status, agent, board moves and archive (`5332673`), with a `factory:issues-changed` event that reloads the sidebar at once. Version-gated polling is open. |
