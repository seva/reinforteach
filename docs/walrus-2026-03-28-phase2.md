# WaLRuS-DATA — 2026-03-28

Session scope: Phase 2 — Candidate Pipeline complete; all four modules built and tested.

---

## Wins

- `src/feedback_analyzer.ts`: `analyzeFeedback` spawns subagent via injected `spawnAgent`; validates JSON response `{sentiment, magnitude, hypothesis, attributed_turn}`; returns null below confidence threshold
- `src/candidate_synthesizer.ts`: `synthesizeCandidate` coordinates oracle; negative path `chosen=oracle/rejected=agent`; positive path `chosen=agent/rejected=oracle-degraded`; `reward=sentiment×magnitude`; prompt excludes agent's evaluated turn
- `src/confirmation_handler.ts`: `handleConfirmation` operator round-trip; approve/yes/+1 → buffer; reject/no/-1 → discard; free text → edit chosen; null → timeout; four-outcome discriminated union
- `src/training_buffer.ts`: `appendToBuffer` confidence gate (`|reward| >= threshold`); first `heldOutSize` candidates → `held_out.jsonl`; subsequent → `training.jsonl`; `readTrainingSet` returns training only
- 65/65 tests green

## Learnings

- DPO `prompt` must exclude the agent's evaluated turn — including it contaminates the preference signal (model sees its own rejected output as context)
- Real LLM subagent output will contain prose, markdown fences, or reasoning prefixes around JSON — `JSON.parse` on raw output will throw `ValidationError`; a stripping step is needed before live use
- DPO `reward` field is not consumed by the trainer (global `beta` only) — its value is: confidence gate before buffer write, held-out stratification, future reward-weighted DPO compatibility

## Risks

- Subagent JSON wrapping — `parseAndValidate` in `feedback_analyzer.ts` requires clean JSON; real model output needs a pre-parse stripping step (strip ` ```json `, leading prose, trailing commentary)
- Edit response ambiguity — any non-keyword operator message treated as edit; an accidental follow-up question produces a nonsensical `chosen` in the buffer; needs live observation
- Held-out set representativeness — frozen by insertion order; early candidates may be systematically lower-quality during pipeline tuning; no stratification in v1

## Strategy

Phase 3 begins with training scheduler. Key handoff points from Phase 2: `readTrainingSet` (training scheduler reads candidates) and `held_out.jsonl` path (deployment gate evaluates against it). Python ML components (dpo_runner, gguf_converter, deployment_gate) are first new code not following the injected-TS pattern — subprocess boundary.

## Decisions

- Keyword-based confirmation parsing: approve/yes/+1, reject/no/-1, else=edit — simple and predictable
- `reward` stored but not fed to DPO trainer — used as filter gate and future-proofing only
- All external I/O injected: consistent with Phase 1; real implementations deferred to integration phase
- `prompt` = context window minus last assistant turn

## Alignment

- Injected dependency pattern is the project standard; no module imports `fs` or calls OpenClaw gateway directly
- Every subagent-facing function validates its response with `parseAndValidate` + `ValidationError`
- Buffer is append-only; held-out set is never returned to callers

## Tradeoffs

- Keyword-based confirmation: low friction for operator — cost: any non-keyword response (including accidental messages) is silently treated as an edit
- Confidence gate before buffer: clean high-signal buffer — cost: borderline candidates with correct sentiment but weak magnitude are discarded; buffer fills slower
- Oracle at collection time (DPO): predictable cost, offline training — cost: if oracle improves after collection, old labels don't update; quality ceiling set at collection time

## Alternatives

- Structured edit format (e.g., `{edit: "..."} JSON`): rejected — too much operator friction; free text is more natural and handles the common case
- Continuous reward signal in trainer (GRPO): deferred to later phase — requires live oracle at training time, vLLM, significantly heavier infrastructure
- Per-sample reward weighting in DPO (SimPO/Cal-DPO): deferred — `reward` field preserves the option without requiring it now
