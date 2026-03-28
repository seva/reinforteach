# Discovery: OpenClaw Subagent Spawn API

Source: `src/config/sessions/types.ts`

---

## What the source confirms

`SessionEntry` has a `spawnedBy?: string` field — the parent `sessionKey`. This establishes that subagent sessions are first-class sessions with a parent pointer, not lightweight in-process calls.

`SessionOrigin` is set at session creation and persists across resets — subagent sessions inherit or receive their own origin context.

---

## Invocation pattern (inferred from gateway CLI usage)

OpenClaw gateway methods follow the pattern:
```
openclaw gateway call <method> --params '<json>'
```

Subagent spawning is expected to be a gateway method of the form `sessions.spawn` or `agents.spawn`, passing:
- the target agent/model config
- the parent `sessionKey` (becomes `spawnedBy` in the child session)
- initial prompt or context payload

**This is inferred, not verified from source.** The spawn method name and exact params schema need confirmation from:
- `src/gateway/server-methods/` — look for a `spawn` or `subagent` method handler
- Or: test `openclaw gateway call sessions.list` to observe a live subagent session's `spawnedBy` field and trace backward

---

## What the pipeline needs

The Feedback Analyzer and Candidate Synthesizer are subagent sessions. The pipeline (running as a plugin/hook) needs to:

1. **Spawn** a subagent with a specific prompt and context payload
2. **Wait** for the subagent to complete (synchronously or via polling)
3. **Read** the subagent's output from its transcript or a structured return value

The `spawnedBy` link means the parent session can find its child sessions via `sessions.list` filtered by `spawnedBy === parentSessionKey`.

---

## Gap

The exact method name and params schema for spawning a subagent are not confirmed from source. Must verify before implementing the Feedback Analyzer invocation in Phase 1.

**Action for Phase 1:** Before writing the plugin that spawns subagents, run:
```
openclaw gateway call --list
```
to enumerate available methods and locate the spawn endpoint.
