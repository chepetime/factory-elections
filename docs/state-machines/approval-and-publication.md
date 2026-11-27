# Review, approval and publication

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| Review — driver | verified HEAD → reviewing → valid review or failed call/output | Either valid verdict stops at human review. Request-changes is not human rejection. |
| PR draft — driver/core | absent/stale → drafting → current or unavailable | Optional and bound to HEAD. Writer failure never grants approval or blocks otherwise valid review. |
| Human decision — driver/core | awaiting → approved/rejected; stale when commit changes | Preserve exact reviewed HEAD and explicit blocking-findings acceptance. Recheck verification/review/approval before publishing. Push the exact approved SHA (`<sha>:refs/heads/<branch>`, never the branch name) and read the remote ref back; a ref that is not the approved SHA fails `openPr` and keeps the publication intent. |
| Publication — driver/GitHub | approved → push → external PR → stored PR | Explicit action, no automatic retry. External creation and local persistence are not atomic; inspect GitHub after an ambiguous failure. |
| Decision commands — web | submitted → running (toast) → done or failed (toast) | Approve, approve-and-open-PR, open-PR and reject post to `POST /api/projects/<p>/tasks/<id>/commands` with `fetch`, not a server action: Next.js holds every navigation while a server action is pending, so a push to GitHub froze the app. The route runs the same action functions. A toast reports the outcome on whatever page is open; the sending page refreshes if it is still shown. |
