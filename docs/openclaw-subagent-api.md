# Discovery: OpenClaw Subagent Spawn API

Source: `src/gateway/server-methods/agent.ts`

## Method: `agent`

Subagents are spawned via the existing `agent` gateway method with a `spawnedBy` param. No separate spawn endpoint.

### Required params

```
message          string   — prompt sent to the subagent
idempotencyKey   string   — deduplication key; use a unique ID per invocation
```

### Key optional params

```
agentId          string   — which configured agent to use (from openclaw.json)
sessionKey       string   — target session key; omit to auto-create a new session
spawnedBy        string   — parent sessionKey; sets the parent-child relationship
                            (child SessionEntry.spawnedBy = this value)
extraSystemPrompt string  — additional context injected into the system prompt
timeout          number   — timeout in ms
deliver          boolean  — whether to deliver the response to a channel (default: false for subagents)
```

### Response frames

The method is async and responds twice:

**Frame 1 (immediate):** `{ runId, status: "accepted", acceptedAt }`

**Frame 2 (on completion):** `{ runId, status: "ok", summary: "completed", result }`
— only received when `--expect-final` flag is set.

On error: `{ runId, status: "error", summary: "<error string>" }`

### Invocation pattern

```bash
openclaw gateway call agent --expect-final --params '{
  "message": "<prompt with full context>",
  "agentId": "main",
  "spawnedBy": "agent:main:main",
  "idempotencyKey": "reinforce-<component>-<uuid>",
  "extraSystemPrompt": "<structured context block>",
  "deliver": false,
  "timeout": 60000
}'
```

`--expect-final` blocks until the second response frame arrives (agent run complete).

### How context is passed

Two channels:

1. **`message`** — the main prompt. Include the attributed turn, feedback event, and any structured input the subagent needs to reason over.
2. **`extraSystemPrompt`** — injected into the system prompt. Use for standing instructions or role definition that shouldn't be part of the conversational message.

### How to read output

Option A — `--expect-final`: the `result` field in the second response frame contains the agent's final output.

Option B — transcript: after run completes, find the child session via `sessions.list` filtered by `spawnedBy`, then read its JSONL transcript at `sessionFile`. The last `assistant` role message is the subagent's response.

### Finding child sessions after run

```bash
openclaw gateway call sessions.list --params '{}' | jq '.[] | select(.spawnedBy == "agent:main:main")'
```

## Resolved

Open Question #4 is closed. Spawn method: `agent` with `spawnedBy`. Output via `--expect-final` or transcript read.
