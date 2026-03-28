# WaLRuS — Phase 1: Feedback Capture & Attribution
**Date:** 2026-03-28
**Commit:** af7ed0f
**Issue:** seva/reinforteach#3

---

## What was built

Two modules:

**`src/plugin/feedback_capture.ts`**
OpenClaw plugin with two pure handler functions separated from hook registration for testability.
- `handleMessageReceived(event, context) → MessageFeedbackEvent` — maps channel message to typed event; timestamp falls back to `Date.now()`; strips unknown fields; optional context fields (conversationId, accountId) passed through only when present
- `handleAfterToolCall(event, context) → ToolCallFeedbackEvent` — maps tool execution result to typed event; captures error xor result; always sets timestamp to now
- `export default { id, name, register(api) }` — OpenClaw plugin entry point

**`src/attribution.ts`**
`attributeFeedback(event, context) → Promise<AttributedFeedback | null>`
Session lookup strategy: tool_call events carry `sessionKey` directly; message events are matched by `origin.from`. Transcript resolution: reads active transcript first; if empty, falls back to most-recent entry in `archivedTranscripts[]` (post-reset path). Returns `{ feedbackEvent, sessionKey, contextWindow }` or `null` when no session matches.

**`vitest.config.ts`**
Stub config kept for future use (coverage, reporters). Test files use Vitest default naming: `*.test.ts`.

---

## Decisions made

**`readTranscript` injected, not imported**
Attribution receives a `readTranscript: (path) => Promise<TranscriptLine[]>` function rather than importing `fs` directly. This keeps the module pure and testable without mocking Node built-ins.

**Archive lookup uses last entry, not timestamp sort**
`archivedTranscripts[]` is treated as ordered (earliest to latest); `slice(-1)[0]` gets the most recent. This avoids parsing ISO timestamps from filenames. If multi-reset traversal is needed in a later phase, the caller controls the array order.

**`sessionKey` direct-match for tool_call events**
Tool call events always carry `sessionKey` from the OpenClaw hook context. No origin lookup needed — direct array find is O(n) and sufficient at this scale.

---

## What was NOT built

**Live capture verification** — manual step; requires a running OpenClaw gateway. Test suite covers the pure logic. The integration path (hook fires → `handleMessageReceived` → `attributeFeedback` → log entry) is structurally sound but unverified end-to-end.

---

## Surprises

**pytest-style naming was wrong for TS** — initially named files `test_hooks.ts` / `test_attribution.ts` (epistegrity artifact). Vitest silently found zero files; fixed by renaming to `hooks.test.ts` / `attribution.test.ts` and dropping the custom include pattern. All future TS test files use `*.test.ts`.

---

## Phase 2 entry conditions

All met:
- `FeedbackEvent` type exported and stable
- `AttributedFeedback` type exported
- 14/14 tests green
- Commit on main, pushed

Next: Phase 2 — Candidate Pipeline (seva/reinforteach#4)
First task: `tests/candidate_pipeline/test_feedback_analyzer.ts`
