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
- [x] `tests/feedback_capture/hooks.test.ts`
  - `message_received` handler produces `FeedbackEvent` with `from`, `content`, `conversationId`, `timestamp`
  - `after_tool_call` handler produces `FeedbackEvent` with `toolName`, `params`, `result`, `agentId`, `sessionKey`
  - Unknown/malformed event fields are dropped gracefully
- [x] `src/plugin/feedback_capture.ts` — OpenClaw plugin registering `message_received` and `after_tool_call` hooks; emits structured `FeedbackEvent` with session snapshot
- [x] `tests/feedback_capture/attribution.test.ts`
  - Feedback event attributed to correct turn in active session (by `sessionKey` + turn index within `feedback_window_turns`)
  - Attribution recovers correctly when session has been reset: uses `origin` match + archived transcript
  - Attribution fails gracefully (returns `null`) when no matching turn found
- [x] `src/attribution.ts` — correlates `FeedbackEvent` to `(turn_id, context_window)` using session transcript; handles reset via archive traversal

**Verification:** Given a live agent interaction and a subsequent feedback message on the same channel, the pipeline produces a `AttributedFeedback` record containing the attributed turn context and feedback event. Passes all tests. Confirmed via test suite and a manual live capture log entry.

---

## Phase 2 — Candidate Pipeline

Refs #4

**Goal:** An attributed feedback event produces a confirmed DPO candidate `{prompt, chosen, rejected, reward}` appended to the training buffer.

### Tasks

- [x] `tests/candidate_pipeline/feedback_analyzer.test.ts`
  - Subagent invocation returns structured `{sentiment, magnitude, hypothesis, attributed_turn}`
  - Negative sentiment path: `sentiment < 0`, `magnitude > 0`
  - Positive sentiment path: `sentiment > 0`, inverted chosen/rejected roles documented
  - Low-confidence result (`magnitude < confidence_threshold`) is filtered before synthesizer
- [x] `src/feedback_analyzer.ts` — spawns Feedback Analyzer subagent with attributed context; parses and validates response
- [x] `tests/candidate_pipeline/candidate_synthesizer.test.ts`
  - Negative path: `chosen` = oracle completion, `rejected` = original agent output
  - Positive path: `chosen` = original agent output, `rejected` = oracle-degraded version
  - `reward` = `sentiment × magnitude` (signed float)
  - Output matches DPO jsonl schema: `{prompt, chosen, rejected, reward}`
- [x] `src/candidate_synthesizer.ts` — spawns Candidate Synthesizer subagent with oracle; returns DPO-shaped candidate record
- [x] `tests/candidate_pipeline/confirmation.test.ts`
  - Confirmation message sent to originating channel with `hypothesis`, `chosen`, `rejected`
  - Operator approval → candidate passed to buffer
  - Operator rejection → candidate discarded, no buffer write
  - Operator edit → edited candidate passed to buffer
  - Timeout (no response) → candidate discarded
- [x] `src/confirmation_handler.ts` — sends candidate to operator channel; awaits response; routes to buffer or discard
- [x] `tests/candidate_pipeline/buffer.test.ts`
  - Confirmed candidate appended as valid jsonl line
  - Candidate with `|reward| < confidence_threshold` rejected before append
  - First `N` candidates frozen as held-out set; subsequent writes go to training set only
  - Buffer read returns training set only (not held-out)
- [x] `src/training_buffer.ts` — append-only jsonl store; enforces `confidence_threshold` gate; manages held-out set initialization

**Verification:** Send a test correction message → pipeline produces a confirmed DPO record in `training_buffer.jsonl`. Held-out set initialized with first N candidates. All tests pass.

---

## Phase 3 — Training & Deployment

Refs #5

**Goal:** When the training buffer reaches trigger conditions, a Unsloth DPO run produces a LoRA adapter that is evaluated and hot-swapped onto the running llama.cpp server.

### Tasks

- [x] `tests/training/scheduler.test.ts`
  - Trigger fires when `len(training_set) >= min_candidates`
  - Trigger fires when `max_interval` elapsed regardless of buffer size
  - Trigger does not fire when both conditions unmet
  - Re-entrancy guard: second trigger while training in progress is a no-op
- [x] `src/training_scheduler.ts` — cron-based trigger; evaluates buffer conditions; invokes Python training subprocess; re-entrancy guard
- [x] `tests/training/test_dpo_runner.py`
  - Training run on synthetic buffer produces `adapter_model.safetensors` in output dir
  - Run fails cleanly (logged, no crash) when buffer has fewer than `min_candidates`
- [x] `src/dpo_runner.py` — wraps Unsloth DPO training; reads `training_buffer.jsonl`; writes LoRA adapter to configured output dir
- [x] `tests/training/test_gguf_conversion.py`
  - `convert-lora-to-gguf.py` converts `adapter_model.safetensors` → `adapter.gguf`
  - Output file is valid GGUF (header check)
- [x] `src/gguf_converter.py` — shells out to `convert-lora-to-gguf.py`; validates output
- [x] `tests/training/test_deployment_gate.py`
  - Delta eval on held-out buffer returns a float
  - Gate passes (deploys) when delta ≥ 0
  - Gate blocks (logs, no deploy) when delta < 0
- [x] `src/deployment_gate.py` — runs held-out eval against new adapter vs baseline; returns delta; gates deployment
- [x] `tests/training/deploy.test.ts`
  - `POST /lora-adapters` called with correct adapter id and scale
  - Successful swap logged; failed swap raises and logs without crashing pipeline
- [x] `src/lora_deployer.ts` — calls llama.cpp `POST /lora-adapters`; logs result; handles errors

**Verification:** Seed buffer with N synthetic DPO candidates; trigger training run; verify `adapter.gguf` produced; verify delta eval logged; verify adapter active on llama.cpp server (`GET /lora-adapters` confirms). All tests pass.

---

## Phase 4 — Integration

Refs #6

**Goal:** Connect the subprocess chain and add config loading. Components pass unit tests; integration wiring is the remaining gap before live verification.

### Tasks

- [x] `tests/integration/test_train_and_deploy.py`
  - Full chain with synthetic buffer: produces `adapter.gguf`, returns deploy decision
  - Blocks (no deploy) when deployment gate delta < 0
  - Nonzero exit when dpo_runner fails (buffer too small)
- [x] `src/train_and_deploy.py` — orchestration subprocess: chains dpo_runner → gguf_converter → deployment_gate; exit code 0 = deploy, 1 = block, 2 = error; JSON to stdout with `{adapter_path, delta, deploy}`
- [x] `tests/integration/scheduler_subprocess.test.ts`
  - `runTraining` spawns `train_and_deploy.py` with correct args
  - Resolves on exit code 0 or 1 (deploy/block); rejects on exit code 2 (error)
- [x] `src/training_scheduler.ts` — wire real `runTraining`: `child_process.spawn('python', ['src/train_and_deploy.py', ...args])`
- [x] `tests/integration/config_loader.test.ts`
  - Reads `adaptive_learning` block from fixture config file
  - Returns typed `AdaptiveLearningConfig` struct
  - Fails with clear error when required fields missing
- [x] `src/config_loader.ts` — reads per-agent `adaptive_learning` config from OpenClaw config file; typed; injectable path

**Verification:** Seed buffer with synthetic candidates → invoke `train_and_deploy.py` directly → verify adapter produced + deploy decision in stdout. Scheduler integration test passes with subprocess mock. Config loader reads fixture config and returns typed struct.

---

## Phase 5 — Plugin Assembly & Live Wiring

Refs #7

**Goal:** Wire all TypeScript pipeline components into a single plugin entry point; implement the real llama.cpp scorer for the deployment gate; configure for live OpenClaw deployment.

**Prerequisite:** llama.cpp log-prob scoring approach verified (OQ #5 — check `/completion` for token log-prob output; document approach or decide on judge-model alternative in `docs/llamacpp-scoring.md`).

### Tasks

- [ ] llama.cpp scorer discovery: verify log-prob or judge-model approach → `docs/llamacpp-scoring.md`
- [ ] `tests/plugin/pipeline.test.ts`
  - Synthetic `FeedbackEvent` flows through full TS pipeline to buffer write
  - Config loaded from fixture via `loadConfig`
  - All downstream components (attribution, analyzer, synthesizer, confirmation, buffer) injected
  - Negative signal path: event → `AttributedFeedback` → analysis → candidate → confirmed → buffer append
  - Positive signal path: inverted chosen/rejected → buffer append
  - Low-confidence analysis filtered before synthesizer
- [ ] `src/plugin/pipeline.ts` — assembles all TS components; loads config via `loadConfig`; exposes `handleFeedbackEvent(event, hostSession, sessions, config)` called by feedback_capture hooks
- [ ] `tests/training/test_real_scorer.py`
  - Scorer calls llama.cpp for each held-out candidate
  - Returns float score (mocked llama.cpp responses)
  - Scorer with adapter path vs scorer with `None` (baseline) produce distinct scores
- [ ] `src/deployment_gate.py` `_default_scorer` — real scorer using llama.cpp; approach per `docs/llamacpp-scoring.md`
- [ ] `package.json` — add `"openclaw": { "extensions": ["src/plugin/pipeline.ts"] }`

**Verification:** Load plugin in OpenClaw test agent; send synthetic feedback message; trace event through pipeline; verify `AttributedFeedback` logged and candidate appears in `training_buffer.jsonl`. Seed buffer; invoke `train_and_deploy.py` directly against live llama.cpp; verify adapter deployed (`GET /lora-adapters` confirms). All tests pass.

---

## Open Questions

1. **DPO vs GRPO** — resolved in Phase 0. DPO for Phase 1: candidate synthesizer maps directly to DPO format; oracle at collection time. GRPO deferred (requires live oracle at training time + vLLM). See `docs/training-algorithm-tradeoffs.md`.

2. **Positive signal path success criterion** — resolved in Phase 0. Explicit operator positive signal, same pipeline with inverted chosen/rejected. No unattended path in v1. See `docs/positive-signal-path.md`.

3. **Attribution across session resets** — resolved in Phase 0. `origin` field survives reset (contains `from`, `surface`, `threadId`). Archived transcripts preserved at `{sessionFile}.reset.{ISO-timestamp}`. Attribution recoverable via origin match + archived transcript traversal. See `docs/openclaw-primitives.md`.

4. **Subagent spawn method** — resolved. Method is `agent` with `spawnedBy` param. Output via `--expect-final` flag or transcript read. See `docs/openclaw-subagent-api.md`.

5. **llama.cpp scoring approach** — open. `POST /completion` does not document log-prob output. Options: (a) `logprobs` parameter in newer builds; (b) judge-model (prompt model as judge, score by preference frequency). Must resolve before implementing `_default_scorer`. See `docs/llamacpp-scoring.md` (pending).

---

## Dependencies

**TypeScript** (`package.json`): `vitest`, `@vitest/coverage-v8`, `@types/node`; peer dep `openclaw >=2026.3.11`

**Python** (`pyproject.toml`): `pytest >=7.0` (dev); runtime deps (`unsloth`, `trl`, `datasets`, `torch`) required at integration time — not in pyproject.toml until ML environment is pinned
