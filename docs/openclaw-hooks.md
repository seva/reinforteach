# Discovery: OpenClaw Hook Payloads

Source: `src/plugins/types.ts`

## Naming correction

The spec references `onMessage` and `onToolCall`. Actual hook names differ:

| Spec name | Actual hook name |
|---|---|
| `onMessage` | `message_received` |
| `onToolCall` | `before_tool_call` / `after_tool_call` |

---

## `message_received`

Fires when an inbound message arrives on any channel.

**Event fields:**
```
from        string
content     string
timestamp   number (optional)
metadata    Record<string, unknown> (optional)
```

**Context fields:**
```
channelId       string
accountId       string (optional)
conversationId  string (optional)
```

Return type: `void` (observation only).

**Use in pipeline:** Feedback capture. The `from`, `content`, and `conversationId` fields are the attribution anchors.

---

## `message_sending`

Fires before an outbound message is sent.

**Event fields:**
```
to        string
content   string
metadata  Record<string, unknown> (optional)
```

**Return:** `{ content?: string, cancel?: boolean }` — can modify or suppress the outbound message.

---

## `before_tool_call`

Fires before a tool is invoked.

**Event fields:**
```
toolName  string
params    Record<string, unknown>
```

**Context fields:**
```
agentId     string (optional)
sessionKey  string (optional)
toolName    string
```

**Return:** `{ params?: Record<string, unknown>, block?: boolean, blockReason?: string }` — can modify params or block execution.

---

## `after_tool_call`

Fires after a tool completes (or fails).

**Event fields:**
```
toolName    string
params      Record<string, unknown>
result      unknown (optional) — tool return value
error       string (optional)  — set if tool failed
durationMs  number (optional)
```

**Context fields:** same as `before_tool_call` (`agentId`, `sessionKey`, `toolName`).

Return type: `void`.

**Use in pipeline:** Tool call log capture. `agentId` + `sessionKey` link this event to a specific session turn.

---

## `tool_result_persist`

Fires when a tool result message is about to be written to the transcript.

**Event fields:**
```
toolName     string (optional)
toolCallId   string (optional)
message      AgentMessage  — the message being persisted
isSynthetic  boolean (optional) — true if synthesized by guard/repair
```

**Context fields:**
```
agentId     string (optional)
sessionKey  string (optional)
toolName    string (optional)
toolCallId  string (optional)
```

**Return:** `{ message?: AgentMessage }` — can modify the message before it's written.

---

## Internal hook base structure

All internal hooks (`command`, `session`, `agent`, `gateway` type events):

```
type     "command" | "session" | "agent" | "gateway"
action   string  — e.g. "new", "reset", "bootstrap"
sessionKey  string
context  Record<string, unknown>
timestamp   Date
messages    string[]  — hook can append messages to deliver to user
```
