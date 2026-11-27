# Chats

Part of [the state-machine index](../state-machines.md).

| Machine / source | States and transitions | Decision / invariant |
| --- | --- | --- |
| Agent chat — backend | idle → working → idle; `working` without a live reply reads as idle | Keep the in-process owner as the truth; a restart never leaves a chat working. |
| Agent chat stream — chat transport | submitted → streaming → finished / stopped / lost | A step with no recorded result closes when the reply ends or stops. After about 30 s of failed polls the stream ends with an error, not an endless "streaming". |
| Chat composer/menus/pickers | editable → sending → sent/error; controlled/local values; recording → commit/discard | Keep synchronous send lock, preserved draft on failure, immutable payload and recording/send exclusion. Folder/app/model/approval choices remain independent. |
| Conversation scroll — task chat | pinned → user scrolled away → pinned | Follow new messages only when pinned; preserve user position. |
