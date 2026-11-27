# Features

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| Feature — core/backend | grilling → spec → spec-approved → board → implementing → qa → done; any open stage → cancelled | One command table (`featureCommandBlockers`) replaces inline stage checks. `done` and `cancelled` accept no command. A step that ends after a cancel keeps its cost and text, not its stage. A failed QA step waits for a person; the loop does not pay for it again. |
| Feature cancel — core/backend | open stage → cancelled; live runs stop, other open runs are rejected | A second cancel returns the cancelled feature, not an error. A done feature still refuses cancel. Open pull requests stay. A run that could not be closed is named in the feature error. |
| Feature spec and board edit — web | view → edit → saved or refused | The page has controls for `save-spec` and `save-board`. Saving an approved specification returns it to `spec` for a new approval. The backend checks the board. |
| Feature page — features | advertised actions → controls; working → auto-refresh | The page keeps no stage rules. It shows a control for each allowed action, the questions, ticket states and the QA plan, so every inbox item for a feature has its action on the page. A refused command keeps the typed answer. Cancel asks first. |
