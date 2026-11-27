# Other UI state

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| Forms — action form/task composers | draft → pending → result/error; revision success clears draft | Keep action-state feedback and pending controls. Separate intake partial success from total failure. |
| Member assignment — team edits/table | per member idle → optimistic pending → committed/rolled back | Reducer rolls back only the affected member, ignores stale responses, serializes same-member edits and handles thrown failures. Different members can save concurrently. |
| Team view — table | all/team/tag filter; query; grouped/flat; picker open/draft/selection | Keep independent local state. Explicit UTC date formatting avoids locale-dependent hydration changes. |
| Resources — app shell | loading → loaded/failed; navigation/refetch supersedes old response | Existing tagged load state and live-response guards stay local. |
| Sidebar — shell | desktop/narrow; closed/open drawer; idle/dragging resize; copy feedback | Keep focus return, Escape/navigation close and bounded stored width. |
| Health/status — health bridge/panel/status | checking → available/degraded/unreachable; refresh with last report | Fixed failed-check headline: it no longer remains “running” or claims fresh success. Keep timeouts and explicit unavailable results. |
| Findings/checkpoints — agent components | filter/selection; focus/keyboard navigation | Local presentation state never drives backend workflow. |
| Catalog/demos — library and demo components | search/category/style/selection/reset; attachments/dictation; findings rounds; checkpoint reducer | Keep simulations isolated. Demo send/approval is not a production command. Upstream primitives retain their own interaction machines. |
