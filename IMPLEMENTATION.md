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

## Phase 1 — Feedback Capture & Attribution

Refs #3

**Goal:** Operator feedback arriving on any channel is captured via hooks, attributed to the agent turn that triggered it, and stored as a structured event ready for analysis.

**Prerequisite:** Subagent spawn method verified (OQ #4 — run `openclaw gateway call --list`, update `docs/openclaw-subagent-api.md`).

### Tasks

- [x] Verify subagent spawn method: `openclaw gateway call --list` → update `docs/openclaw-subagent-api.md`
- [ ] `tests/feedback_capture/test_hooks.py`
  - `message_received` hook fires and event contains `from`, `content`, `conversationId`, `timestamp`
  - `after_tool_call` hook fires and event contains `toolName`, `params`, `result`, `agentId`, `sessionKey`
  - Plugin registration does not interfere with normal message/tool flow
- [ ] `src/feedback_capture.py` — plugin registering `message_received` and `after_tool_call` hooks; emits structured `FeedbackEvent` with session snapshot
- [ ] `tests/feedback_capture/test_attribution.py`
  - Feedback event attributed to correct turn in active session (by `sessionKey` + turn index within `feedback_window_turns`)
  - Attribution recovers correctly when session has been reset: uses `origin` match + archived transcript
  - Attribution fails gracefully (returns `None`) when no matching turn found
- [ ] `src/attribution.py` — correlates `FeedbackEvent` to `(turn_id, context_window)` using session transcript; handles reset via archive traversal

**Verification:** Given a live agent interaction and a subsequent feedback message on the same channel, the pipeline produces a `AttributedFeedback` record containing the attributed turn context and feedback event. Passes all tests. Confirmed via test suite and a manual live capture log entry.

---

## Phase 2 — Candidate Pipeline

Refs #4

**Goal:** An attributed feedback event produces a confirmed DPO candidate `{prompt, chosen, rejected, reward}` appended to the training buffer.

### Tasks

- [ ] `tests/candidate_pipeline/test_feedback_analyzer.py`
  - Subagent invocation returns structured `{sentiment, magnitude, hypothesis, attributed_turn}`
  - Negative sentiment path: `sentiment < 0`, `magnitude > 0`
  - Positive sentiment path: `sentiment > 0`, inverted chosen/rejected roles documented
  - Low-confidence result (`magnitude < confidence_threshold`) is filtered before synthesizer
- [ ] `src/feedback_analyzer.py` — spawns Feedback Analyzer subagent with attributed context; parses and validates response
- [ ] `tests/candidate_pipeline/test_candidate_synthesizer.py`
  - Negative path: `chosen` = oracle completion, `rejected` = original agent output
  - Positive path: `chosen` = original agent output, `rejected` = oracle-degraded version
  - `reward` = `sentiment × magnitude` (signed float)
  - Output matches DPO jsonl schema: `{prompt, chosen, rejected, reward}`
- [ ] `src/candidate_synthesizer.py` — spawns Candidate Synthesizer subagent with oracle; returns DPO-shaped candidate record
- [ ] `tests/candidate_pipeline/test_confirmation.py`
  - Confirmation message sent to originating channel with `hypothesis`, `chosen`, `rejected`
  - Operator approval → candidate passed to buffer
  - Operator rejection → candidate discarded, no buffer write
  - Operator edit → edited candidate passed to buffer
  - Timeout (no response) → candidate discarded
- [ ] `src/confirmation_handler.py` — sends candidate to operator channel; awaits response; routes to buffer or discard
- [ ] `tests/candidate_pipeline/test_buffer.py`
  - Confirmed candidate appended as valid jsonl line
  - Candidate with `|reward| < confidence_threshold` rejected before append
  - First `N` candidates frozen as held-out set; subsequent writes go to training set only
  - Buffer read returns training set only (not held-out)
- [ ] `src/training_buffer.py` — append-only jsonl store; enforces `confidence_threshold` gate; manages held-out set initialization

**Verification:** Send a test correction message → pipeline produces a confirmed DPO record in `training_buffer.jsonl`. Held-out set initialized with first N candidates. All tests pass.

---

## Phase 3 — Training & Deployment

Refs #5

**Goal:** When the training buffer reaches trigger conditions, a Unsloth DPO run produces a LoRA adapter that is evaluated and hot-swapped onto the running llama.cpp server.

### Tasks

- [ ] `tests/training/test_scheduler.py`
  - Trigger fires when `len(training_set) >= min_candidates`
  - Trigger fires when `max_interval` elapsed regardless of buffer size
  - Trigger does not fire when both conditions unmet
  - Re-entrancy guard: second trigger while training in progress is a no-op
- [ ] `src/training_scheduler.py` — cron-based trigger; evaluates buffer conditions; invokes training run; re-entrancy guard
- [ ] `tests/training/test_dpo_runner.py`
  - Training run on synthetic buffer produces `adapter_model.safetensors` in output dir
  - Run fails cleanly (logged, no crash) when buffer has fewer than `min_candidates`
- [ ] `src/dpo_runner.py` — wraps Unsloth DPO training; reads `training_buffer.jsonl`; writes LoRA adapter to configured output dir
- [ ] `tests/training/test_gguf_conversion.py`
  - `convert-lora-to-gguf.py` converts `adapter_model.safetensors` → `adapter.gguf`
  - Output file is valid GGUF (header check)
- [ ] `src/gguf_converter.py` — shells out to `convert-lora-to-gguf.py`; validates output
- [ ] `tests/training/test_deployment_gate.py`
  - Delta eval on held-out buffer returns a float
  - Gate passes (deploys) when delta ≥ 0
  - Gate blocks (logs, no deploy) when delta < 0
- [ ] `src/deployment_gate.py` — runs held-out eval against new adapter vs baseline; returns delta; gates deployment
- [ ] `tests/training/test_deploy.py`
  - `POST /lora-adapters` called with correct adapter id and scale
  - Successful swap logged; failed swap raises and logs without crashing pipeline
- [ ] `src/lora_deployer.py` — calls llama.cpp `POST /lora-adapters`; logs result; handles errors

**Verification:** Seed buffer with N synthetic DPO candidates; trigger training run; verify `adapter.gguf` produced; verify delta eval logged; verify adapter active on llama.cpp server (`GET /lora-adapters` confirms). All tests pass.

---

## Open Questions

1. **DPO vs GRPO** — resolved in Phase 0. DPO for Phase 1: candidate synthesizer maps directly to DPO format; oracle at collection time. GRPO deferred (requires live oracle at training time + vLLM). See `docs/training-algorithm-tradeoffs.md`.

2. **Positive signal path success criterion** — resolved in Phase 0. Explicit operator positive signal, same pipeline with inverted chosen/rejected. No unattended path in v1. See `docs/positive-signal-path.md`.

3. **Attribution across session resets** — resolved in Phase 0. `origin` field survives reset (contains `from`, `surface`, `threadId`). Archived transcripts preserved at `{sessionFile}.reset.{ISO-timestamp}`. Attribution recoverable via origin match + archived transcript traversal. See `docs/openclaw-primitives.md`.

4. **Subagent spawn method** — resolved. Method is `agent` with `spawnedBy` param. Output via `--expect-final` flag or transcript read. See `docs/openclaw-subagent-api.md`.

---

## Dependencies

<!-- Libraries, runtimes, or services this project requires. -->

```
[paste your dependency manifest here — e.g. package.json, pyproject.toml, go.mod]
```
