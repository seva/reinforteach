# Implementation Plan

---

## Phase 0 — Discovery

Must complete before writing implementation code that depends on external interfaces, APIs, or undocumented contracts.

Refs #1

- [x] OpenClaw hooks: read source and trace `onMessage` / `onToolCall` hook payloads — document schema in `docs/openclaw-hooks.md`
- [x] OpenClaw primitives: document what session history and tool call log data is exposed to subagents — `docs/openclaw-primitives.md`
- [x] Subagent spawn API: document how to invoke a subagent, pass context, and receive output — `docs/openclaw-subagent-api.md`
- [x] llama.cpp server API: document model-swap and inference endpoints — `docs/llamacpp-api.md`
- [x] Unsloth training interface: document DPO and GRPO CLI args, dataset format (jsonl fields), and output artifacts — `docs/unsloth-training.md`
- [x] DPO vs GRPO: document data shape requirements for each; evaluate whether the candidate synthesizer can produce both or requires a branch; record tradeoffs — `docs/training-algorithm-tradeoffs.md`
- [x] Positive signal path: define and evaluate "successful session" criterion options (no-correction window, oracle quality score, explicit operator flag); document tradeoffs — `docs/positive-signal-path.md`

**Outputs:** seven discovery docs in `docs/` — hard gates for all implementation phases.

---

## Phase N — [Name]

<!-- Phases defined after Phase 0 discovery. Architecture and acceptance criteria per seva/reinforteach#1: "should be revisited once discovery is done." -->

---

## Open Questions

1. **DPO vs GRPO** — resolved in Phase 0. DPO for Phase 1: candidate synthesizer maps directly to DPO format; oracle at collection time. GRPO deferred (requires live oracle at training time + vLLM). See `docs/training-algorithm-tradeoffs.md`.

2. **Positive signal path success criterion** — resolved in Phase 0. Explicit operator positive signal, same pipeline with inverted chosen/rejected. No unattended path in v1. See `docs/positive-signal-path.md`.

3. **Attribution across session resets** — resolved in Phase 0. `origin` field survives reset (contains `from`, `surface`, `threadId`). Archived transcripts preserved at `{sessionFile}.reset.{ISO-timestamp}`. Attribution recoverable via origin match + archived transcript traversal. See `docs/openclaw-primitives.md`.

4. **Subagent spawn method** — open. `spawnedBy` field confirmed in SessionEntry but spawn method name/params unverified from source. Must confirm via `openclaw gateway call --list` before implementing Phase 1 plugin. See `docs/openclaw-subagent-api.md`.

---

## Dependencies

<!-- Libraries, runtimes, or services this project requires. -->

```
[paste your dependency manifest here — e.g. package.json, pyproject.toml, go.mod]
```
