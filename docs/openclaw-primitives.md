# Discovery: OpenClaw Session Primitives

Source: `src/config/sessions/types.ts`, `src/gateway/session-utils.fs.ts`, `src/gateway/server-methods/sessions.ts`

---

## SessionEntry — fields relevant to the pipeline

```
sessionId       string   — unique identifier (changes on reset)
sessionFile     string   — path to JSONL transcript file
updatedAt       number   — last update timestamp (ms)

model           string   — model alias or identifier
contextTokens   number   — max context window
inputTokens     number   — cumulative input tokens
outputTokens    number   — cumulative output tokens

channel         string   — primary channel name
lastChannel     SessionChannelId
lastTo          string   — last recipient

origin          SessionOrigin  — see below (SURVIVES reset)
spawnedBy       string   — parent sessionKey, set for subagent sessions
```

### SessionOrigin

```
provider    string           — channel type (e.g. "telegram")
surface     string           — channel name
from        string           — originating sender ID
to          string           — recipient ID
chatType    SessionChatType
accountId   string
threadId    string | number
```

---

## Transcript format

Each line of the JSONL transcript file is one of:

**Message line:**
```json
{
  "message": {
    "role": "user" | "assistant" | "system" | "toolResult" | "tool",
    "content": "string or content-block array",
    "toolName": "string (optional)",
    "toolCallId": "string (optional)",
    "provenance": "unknown (optional)"
  }
}
```

**Compaction marker:**
```json
{
  "type": "compaction",
  "timestamp": "ISO-8601",
  "id": "string"
}
```

---

## Session reset — what persists

Source: `sessions.reset` handler in `src/gateway/server-methods/sessions.ts`

### Survives reset

```
thinkingLevel    verboseLevel    reasoningLevel
responseUsage    model           contextTokens
sendPolicy       label
origin           ← full SessionOrigin snapshot — KEY for attribution
lastChannel      lastTo
skillsSnapshot
```

### Reset to fresh values

```
sessionId     → new UUID
updatedAt     → Date.now()
systemSent    → false
abortedLastRun → false
inputTokens   outputTokens totalTokens → 0
```

### Dropped entirely

`chatType`, `elevatedLevel`, `channel`, `groupId`, `subject`, `lastAccountId`, `lastThreadId`,
`deliveryContext`, `compactionCount`, `memoryFlushAt`, `providerOverride`, `modelOverride`,
`queueMode` and related, `cliSessionIds`, `systemPromptReport`.

---

## Attribution across session resets

### The problem

`sessionId` is replaced with a new UUID on reset. The transcript file path changes. The in-memory session window is cleared. Feedback arriving after a reset cannot be linked to pre-reset turns by `sessionId`.

### What makes attribution possible anyway

**`origin` survives reset.** `origin.from` + `origin.surface` (or `origin.threadId`) uniquely identifies the conversation across resets.

**Archived transcripts are not deleted.** On reset, the old transcript is renamed:
```
{sessionFile}.reset.{ISO-timestamp}
```
The full pre-reset turn history is readable from this archived file.

### Attribution strategy

1. Receive feedback via `message_received` hook → capture `from`, `conversationId`, `timestamp`
2. Look up current session by `origin.from` + `origin.surface` match
3. If `sessionId` changed since last known turn (i.e. a reset occurred), locate the archived transcript at `{old_sessionFile}.reset.*`
4. Read the last `feedback_window_turns` turns from the archived transcript for attribution context
5. Proceed with normal feedback analyzer flow using the archived context

### Limitation

If multiple resets occurred between the agent turn and the feedback arrival, multiple archived transcripts must be traversed. The `updatedAt` timestamps on session entries can establish ordering. This is an edge case but should be handled gracefully (fallback: use most recent archived transcript).
