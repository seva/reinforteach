# WaLRuS — Phase 2: Candidate Pipeline
**Date:** 2026-03-28
**Commit:** 5c4f707
**Issue:** seva/reinforteach#4

---

## What was built

**`src/feedback_analyzer.ts`**
`analyzeFeedback(attributed, ctx) → AnalysisResult | null`
Spawns Feedback Analyzer subagent via injected `spawnAgent(params)`; constructs prompt from context window + feedback event; parses JSON response `{sentiment, magnitude, hypothesis, attributed_turn}`; validates all required fields; returns `null` when `magnitude < confidenceThreshold`.

**`src/candidate_synthesizer.ts`**
`synthesizeCandidate(attributed, analysis, ctx) → DPOCandidate`
Calls injected `spawnOracle` with different instructions depending on sentiment sign. Negative: oracle generates correct completion (`chosen=oracle, rejected=agent`). Positive: oracle generates degraded version (`chosen=agent, rejected=oracle`). `prompt` = context window excluding last assistant turn. `reward = sentiment × magnitude`.

**`src/confirmation_handler.ts`**
`handleConfirmation(candidate, operatorId, hypothesis, ctx) → ConfirmationOutcome`
Sends hypothesis + chosen + rejected to operator; awaits response with configurable timeout. Response routing: approve/yes/+1 → append original; reject/no/-1 → discard; any other text → edit chosen field, append edited; null timeout → discard. Returns discriminated union `{status: "approved" | "rejected" | "edited" | "timeout"}`.

**`src/training_buffer.ts`**
`appendToBuffer(candidate, ctx) → BufferWriteResult`
Confidence gate: `|reward| < confidenceThreshold` → rejected. First `heldOutSize` candidates → `held_out.jsonl` (frozen); subsequent → `training.jsonl` only. `readTrainingSet` returns parsed candidates from training file — held-out never returned to callers.

---

## Decisions made

**All external dependencies injected**
`spawnAgent`, `spawnOracle`, `sendMessage`, `awaitResponse`, `appendToBuffer` (in confirmation), `BufferStore` — every I/O boundary injected. Consistent with Phase 1 pattern (`readTranscript`). Real implementations are thin wrappers around OpenClaw gateway calls and `fs` operations — written at integration time.

**Confirmation response parsing is keyword-based**
Approval: `{approve, yes, +1}`. Rejection: `{reject, no, -1}`. Anything else = edit. Simple and predictable. Operator sends a corrected chosen completion as free text.

**`reward` stored but not consumed by DPO trainer**
Per discovery docs: DPO uses global `beta`, not per-sample weights. `reward` serves as: (1) confidence gate before buffer write, (2) held-out stratification metadata, (3) future compatibility with reward-weighted DPO variants.

**`prompt` excludes agent's evaluated turn**
DPO `prompt` = the context the model should respond to. Including the agent's own (rejected) response in the prompt would contaminate the preference signal.

---

## Risks

**Real subagent output format** — all JSON parsing assumes the subagent returns well-formed JSON only. Real LLMs frequently add prose, markdown fences, or reasoning prefixes. The `parseAndValidate` in `feedback_analyzer.ts` will throw `ValidationError` on any non-JSON prefix. A stripping/extraction step may be needed before `JSON.parse` when live-tested.

**Edit response ambiguity** — any message that isn't an approval/rejection keyword is treated as an edit. An operator accidentally sending a follow-up question would produce a nonsensical `chosen` in the buffer. Needs live observation before deciding if a more structured edit protocol is required.

**Held-out set ordering** — the held-out set is frozen by insertion order (first N confirmed candidates). If early candidates are systematically low-quality (e.g., early pipeline tuning), the held-out set may not be representative. No mitigation in v1.

---

## Phase 3 entry conditions

All met:
- `DPOCandidate` type exported and stable (`src/candidate_synthesizer.ts`)
- `readTrainingSet` returns `DPOCandidate[]` — training scheduler can call this
- `held_out.jsonl` populated by buffer — deployment gate can read it
- 65/65 tests green
- Commit on main, pushed
