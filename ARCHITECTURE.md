# Architecture

---

## Principles

**Separation of concerns** — auth, storage, transport, business logic, and interface layers are separate modules. No cross-cutting logic.

**Isolation of fragility** — unstable dependencies (external APIs, undocumented interfaces, third-party services) are contained in a single module. When they change, only that module updates. Nothing else knows about their internal shape.

**Security** — sensitive data never in plaintext on disk or in logs. Secrets never surfaced in tool or API output.

---

## Coding Hygiene

Guard clauses. Graceful degradation. No silent failures. Explicit error types.

Code as documentation — names and structure must be self-explanatory. Comments explain why, not what. Maximize semantic and cognitive ROI.

---

## System Diagram

```
Operator (Telegram / any channel)
  │  feedback message
  ▼
Feedback Capture  (onMessage hook)
  │  raw event + session window
  ▼
Attribution Engine
  │  attributed turn + surrounding context
  ▼
Feedback Analyzer  (subagent)
  │  sentiment, magnitude, hypothesis
  ▼
Candidate Synthesizer  (subagent) ◄─── Oracle  (frozen, higher-capability subagent)
  │  (prompt, rejected, chosen, reward)
  ▼
Confirmation Handler
  │  operator approves / rejects / edits  (same channel as feedback)
  │
  ├─── negative signal: confirmed candidate (chosen=oracle, rejected=agent) → Training Buffer
  │
  └─── positive signal: operator sends "good" / positive reaction
         → same pipeline, inverted roles (chosen=agent, rejected=oracle-degraded)
         → confirmed candidate → Training Buffer
                    │
                    │  (jsonl: prompt, chosen, rejected — DPO format)
                    │  trigger: N candidates OR time window
                    ▼
             Training Scheduler  (cron)
                    │
                    ▼
             Unsloth DPO  (LoRA adapter output)
                    │  adapter_model.safetensors
                    ▼
             Deployment Gate  (delta eval on held-out buffer — deploy only if delta ≥ 0)
                    │
                    ▼
             llama.cpp  POST /lora-adapters  (hot-swap, no model reload)
```

_Last verified: 2026-03-28_

---

## Components

| Component | Responsibility | Key interface |
|---|---|---|
| Feedback Capture | Intercepts `onMessage` / `onToolCall` events and emits raw feedback events with session snapshot | OpenClaw hook registration; throws `ValidationError` on malformed payloads |
| Session Adapter | Maps raw OpenClaw `HostSession` schema to domain `SessionEntry`; derives `archivedTranscripts` via filesystem prefix scan | `toSessionEntry(host, listFiles) → SessionEntry` |
| Attribution Engine | Correlates a feedback event to the agent turn(s) responsible using session window | `attributeFeedback(event, ctx) → AttributedFeedback \| null`; returns null on I/O failure |
| Feedback Analyzer | Subagent: infers sentiment + magnitude, generates hypothesis, optionally consults oracle | Subagent invocation; returns structured analysis |
| Candidate Synthesizer | Subagent: produces (prompt, rejected, chosen, reward) using oracle for chosen completion | Subagent invocation; returns DPO-shaped record |
| Oracle | Frozen higher-capability subagent: generates correct completions and rates session quality | Subagent invocation (configured externally) |
| Confirmation Handler | Presents hypothesis + candidate to operator; collects approval / rejection / edit | Feedback channel message round-trip |
| Training Buffer | Persists confirmed candidates as jsonl; manages held-out set | Append-only write; read by Training Scheduler |
| Config Loader | Parses per-agent `adaptive_learning` config from OpenClaw config file; converts interval strings to ms | `loadConfig(rawJson) → AdaptiveLearningConfig`; throws `ValidationError` on malformed input |
| Training Scheduler | Cron: fires when buffer hits `min_candidates` or `max_interval`; invokes Python training subprocess | `createScheduler(context) → { tick }`; `startCron(context, pollIntervalMs)`; `spawnTrainAndDeploy(config)` |
| Deployment Gate | Runs delta eval on held-out buffer; blocks deployment if delta < 0 | `evaluate_and_gate(config, scorer) → GateResult` |
| llama.cpp Adapter | Swaps active model on llama.cpp server | llama.cpp model-swap API |

_Last verified: 2026-03-28 (updated post-audit)_

---

## Coverage Notes

| File | Uncovered | Classification | Reason |
|---|---|---|---|
| `src/errors.ts:12-14` | `NotFoundError` constructor | Acceptable — reserved for future use | No caller exists in Phases 1–2; will be covered when first thrown |
| `src/config_loader.ts:32-33` | unreachable throw in `parseIntervalMs` | Acceptable — genuinely unreachable | Regex `^(\d+)(d\|h\|m)$` enforces exhaustive switch; comment in source confirms |
| `src/plugin/feedback_capture.ts:106-112` | `plugin.register()` | Acceptable — subprocess-only path | Requires a live or mock OpenClaw API object; pure handlers are tested directly |
| `src/training_scheduler.ts:startCron` | `startCron()` | Acceptable — subprocess-only path | `setInterval` + tick wiring; pure scheduler logic tested via `createScheduler` |
| `src/training_scheduler.ts:spawnTrainAndDeploy (real spawnProcess)` | real subprocess branch | Acceptable — subprocess-only path | `child_process.spawn` wiring; subprocess contract tested via injected `spawnProcess` |
| `src/deployment_gate.py:46,87` | `scorer = _default_scorer` assignment + `_default_scorer()` body | Acceptable — integration-only path | Requires live llama.cpp server; raises `NotImplementedError` to force injection |
| `src/candidate_synthesizer.ts:59,68` | non-string content branches | Acceptable — rare multi-modal path | DPO pipeline uses string content; array/object content is valid OpenClaw schema but not exercised in v1 |
| `src/dpo_runner.py:61-62,78-88` | lazy ML import blocks (`unsloth`, `trl`, `datasets`) | Acceptable — integration-only path | ML libraries not present in test environment; lazy imports allow importing module without GPU/torch |
| `src/dpo_runner.py:108-119,131` | `main()` CLI entry point | Acceptable — subprocess-only path | `argparse` wiring; invoked as subprocess by training scheduler; CLI contract tested via `spawnTrainAndDeploy` |
| `src/gguf_converter.py:44` | `run_subprocess = subprocess.run` | Acceptable — subprocess-only path | Real subprocess wiring; conversion contract tested via injected `run_subprocess` |
| `src/train_and_deploy.py:62-65,76-79,82-85` | lazy import blocks for `trainer`, `converter`, `gater` | Acceptable — integration-only path | Production wiring requires `dpo_runner`, `gguf_converter`, `deployment_gate`; pipeline contract tested via injected callables |
| `src/train_and_deploy.py:111-148,152` | `main()` CLI entry point | Acceptable — subprocess-only path | `argparse` + `sys.exit` wiring; subprocess contract tested via `spawnTrainAndDeploy` |

---

## Error Types

| Type | Module | Meaning |
|---|---|---|
| `ValidationError` | `src/errors.ts` | Hook payload missing required fields or wrong type |
| `ReadFailedError` | `src/errors.ts` | Transcript I/O failure (file missing, permission denied, parse error) |
| `NotFoundError` | `src/errors.ts` | Requested resource does not exist |
| `ConversionError` | `src/gguf_converter.py` | GGUF conversion failed: nonzero subprocess exit or invalid magic header |

Pipeline degradation policy: `ValidationError` propagates (caller decides); `ReadFailedError` caught at attribution boundary → returns `null` (skip event, continue); `ConversionError` propagates to training scheduler (training run aborted, no deployment).

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Oracle capability constraint | Oracle must produce completions of strictly higher quality than the target behavior, and be frozen during the training cycle | DPO quality ceiling: the trained model cannot reliably surpass oracle quality. Oracle ≈ trained model → quality ceiling at current level, marginal/no gains, or degradation from low-contrast pairs. Not a theoretical DPO requirement but a practical floor. |
| Deployment gate | Deploy only if delta eval on held-out buffer is ≥ 0 | Auto-deploying a regressing model silently degrades agent capability; the log alone is not a safeguard |
| Training buffer lifecycle | Clear consumed candidates after each training run; held-out set is frozen at initialization and never trained on | Accumulating stale candidates distorts loss; a held-out set that is also trained on produces a meaningless eval |
| DPO for Phase 1; GRPO deferred | DPO | Candidate synthesizer produces (prompt, chosen, rejected) — DPO shape. GRPO requires live oracle as reward function at training time + vLLM; too heavy for v1. LoRA adapter output for both; hot-swap via `POST /lora-adapters` (no model reload). |
| Positive signal path | Explicit operator positive signal; same pipeline, inverted chosen/rejected | No unattended buffer writes in v1. Passive no-correction window has high false-positive risk. Oracle quality gate viable as Phase 2 throughput supplement once pipeline is validated. |

_Last verified: 2026-03-28 (updated post-audit)_

---

## Language Boundary

| Layer | Language | Reason |
|---|---|---|
| OpenClaw plugin (hooks) | TypeScript | Forced — gateway plugin system is Node.js only |
| Attribution, subagent invocation, confirmation, buffer, scheduler, deployer | TypeScript | Event-driven I/O-bound work; stays on the hot path; no language boundary per event |
| DPO training, GGUF conversion, deployment gate eval | Python | Forced — Unsloth, PyTorch, HuggingFace ecosystem; no viable TS alternative |

**Boundary:** `training_scheduler.ts` invokes `dpo_runner.py` as a subprocess. All ML artifacts (safetensors, GGUF) are files on disk — the handoff is a file path, not a function call.

**Test frameworks:** Vitest (TypeScript); pytest (Python).

---

## Constraints

- OpenClaw session history and tool call log primitives only — no external data injection into the pipeline
- Local model runs via llama.cpp server; no cloud inference for the trained model
- Oracle is a configured subagent, not hardwired — must be strictly higher-capability and frozen relative to training cycles
- All sentiment and magnitude inference is dynamic — no hardcoded mappings
- Operator confirmation is required for all negative signal candidates
- Deployment requires non-negative delta eval on a frozen held-out buffer
- Per-agent configuration: `feedback_window_turns`, `confidence_threshold`, `training_trigger`, `model_path`, `oracle_subagent`

_Last verified: 2026-03-28_
