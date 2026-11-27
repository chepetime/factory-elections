# Task page

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| Task detail — task page | loading/error → observed stage/owner/gates → command pending/result | Use shared policy. Poll only owned queued/running/finalizing work. Interrupted coding no longer spins forever. Unavailable observation disables commands. |
| Task run controls — task run | policy actions → run / revise / approve controls | The page now passes the run's cleanup record to the shared policy, so it no longer offers Run or Revise that the backend refuses after an uncertain cleanup. |
| Live run — run tab | polling → reload on a new page version → polling | The poll continues after a reload. Before, a reload that rendered the same version ended the loop and the spinner stayed. |
| Task Details panel — web | watching → reload on a new page version | `RunWatch` polls while a run works, so the timeline updates outside the Run panel. |
| Issue title and description — web | view → edit → saved | The editor starts from the text on the page now, not the first render. |
