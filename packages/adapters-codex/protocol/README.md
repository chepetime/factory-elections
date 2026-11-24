# Codex app-server protocol (codex-cli 0.172.0)

`src/app-server.ts` is written against the files in `codex-cli-0.172.0/`. They are a pruned copy of the generated bindings: only the types the runner sends or reads. The protocol is experimental, so check them again when `TESTED_RUNTIMES.codexCli` changes.

To generate the full set again:

```sh
codex app-server generate-ts --out <dir>
codex app-server generate-json-schema --out <dir>
```

The TypeScript files are not compiled (`tsconfig.json` does not include this folder). Their imports point to types that were not copied. `JSONRPCMessage.json` is the JSON Schema of the envelope.

## What the runner uses

| Step | Message | Notes |
| --- | --- | --- |
| Framing | One JSON object per line on stdout | No `jsonrpc` field. Notifications also carry `emittedAtMs`. stderr is tracing output only. |
| Handshake | `initialize`, then the `initialized` notification | `InitializeParams`, `InitializeResponse`. |
| New thread | `thread/start` | `model`, `cwd`, `approvalPolicy: "never"`, `sandbox`, `developerInstructions`. The response carries `thread.id`, which is the session id. |
| Resume | `thread/resume` with `threadId` | A missing thread is a JSON-RPC error (`-32600`, "no rollout found for thread id …"). A bad id is also `-32600` ("invalid session id"). |
| Turn | `turn/start` with `input`, `effort`, `outputSchema` | The response carries `turn.id`. |
| Stream | `item/started`, `item/completed`, `item/agentMessage/delta`, `thread/tokenUsage/updated`, `error`, `turn/completed` | Item ids are the tool call ids. `turn/completed` has no usage: usage comes from `thread/tokenUsage/updated`, whose `total` is for the whole thread. |
| Interrupt | `turn/interrupt` with `threadId` and `turnId` | The answer is `{}`. Then `turn/completed` arrives with status `interrupted`. No `item/completed` comes for the stopped command. |
| Server requests | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `execCommandApproval`, `applyPatchApproval`, `mcpServer/elicitation/request`, `item/tool/call`, and others | With approval policy `never`, none came in the real runs. The runner declines each one. Unknown ones get error `-32601`. |

## Flags

`codex app-server` accepts `-c`, `--enable` and `--disable`. It does not accept `--ignore-user-config` (it exits with "unexpected argument"), so the user's `config.toml` loads. The runner sets approval, sandbox, model and instructions on each thread, so those user settings do not apply. Other user settings (for example user MCP servers and skills) still can.

## Not used yet

- **Supplemental input:** `turn/steer` (`TurnSteerParams`: `threadId`, `input`, `expectedTurnId`) adds input to the running turn and answers with its `turnId`. It fails when `expectedTurnId` is not the active turn. The runner does not use it; `supplementalInput` stays `false` until a real test checks the receipt semantics.
- **Approvals as a tool guard:** the approval requests exist, but the runner never screens tool calls with them. A guarded step is refused.
