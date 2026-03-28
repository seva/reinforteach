# Implementation Plan

---

## Phase 0 — Discovery

Must complete before writing implementation code that depends on external interfaces, APIs, or undocumented contracts.

Refs #1

- [ ] OpenClaw hooks: read source and trace `onMessage` / `onToolCall` hook payloads — document schema in `docs/openclaw-hooks.md`
- [ ] OpenClaw primitives: document what session history and tool call log data is exposed to subagents — `docs/openclaw-primitives.md`
- [ ] Subagent spawn API: document how to invoke a subagent, pass context, and receive output — `docs/openclaw-subagent-api.md`
- [ ] llama.cpp server API: document model-swap and inference endpoints — `docs/llamacpp-api.md`
- [ ] Unsloth training interface: document DPO and GRPO CLI args, dataset format (jsonl fields), and output artifacts — `docs/unsloth-training.md`

**Outputs:** five discovery docs in `docs/` — hard gates for all implementation phases.

---

## Phase N — [Name]

<!-- Phases defined after Phase 0 discovery. Architecture and acceptance criteria per seva/reinforteach#1: "should be revisited once discovery is done." -->

---

## Open Questions

<!-- Unresolved unknowns that may affect implementation. Move to ARCHITECTURE.md Design Decisions when resolved. -->

1. [question] — [status: open / resolved in Phase N]

---

## Dependencies

<!-- Libraries, runtimes, or services this project requires. -->

```
[paste your dependency manifest here — e.g. package.json, pyproject.toml, go.mod]
```
