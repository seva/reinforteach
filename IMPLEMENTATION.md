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
- [ ] DPO vs GRPO: document data shape requirements for each; evaluate whether the candidate synthesizer can produce both or requires a branch; record tradeoffs — `docs/training-algorithm-tradeoffs.md`
- [ ] Positive signal path: define and evaluate "successful session" criterion options (no-correction window, oracle quality score, explicit operator flag); document tradeoffs — `docs/positive-signal-path.md`

**Outputs:** seven discovery docs in `docs/` — hard gates for all implementation phases.

---

## Phase N — [Name]

<!-- Phases defined after Phase 0 discovery. Architecture and acceptance criteria per seva/reinforteach#1: "should be revisited once discovery is done." -->

---

## Open Questions

1. **DPO vs GRPO** — DPO needs (prompt, chosen, rejected) triplets; GRPO needs reward scores across multiple candidates per prompt. The candidate synthesizer as spec'd produces one pair — DPO shape only. Does GRPO require a different synthesizer, or a wrapper that samples N completions? — open, resolves in Phase 0 (`docs/training-algorithm-tradeoffs.md`)

2. **Positive signal path success criterion** — Absence of negative feedback ≠ success (operator may not engage). Options: no-correction window + oracle quality score; explicit operator "approve session" signal; oracle-only (unattended). Tradeoffs: trust level, buffer pollution risk, operator burden. — open, resolves in Phase 0 (`docs/positive-signal-path.md`)

3. **Attribution across session resets** — If feedback arrives after a session reset (history wiped), the turn context is gone and attribution fails. Fallback options depend on what OpenClaw persists across resets. — open, resolves in Phase 0 (`docs/openclaw-primitives.md`)

---

## Dependencies

<!-- Libraries, runtimes, or services this project requires. -->

```
[paste your dependency manifest here — e.g. package.json, pyproject.toml, go.mod]
```
