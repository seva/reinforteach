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
  ├─── negative signal: confirmed candidate → Training Buffer (jsonl)
  │
  └─── positive signal path: TBD (see Open Question #2)
         │
         ▼
       Training Buffer (jsonl)
            │  trigger: N candidates OR time window
            ▼
       Training Scheduler  (cron)
            │
            ▼
       Unsloth  (DPO or GRPO — see Open Question #1)
            │  fine-tuned model artifact
            ▼
       Deployment Gate  (delta eval on held-out buffer)
            │  deploy only if delta ≥ 0
            ▼
       llama.cpp server  (model swap)
```

---

## Components

| Component | Responsibility | Key interface |
|---|---|---|
| Feedback Capture | Intercepts `onMessage` / `onToolCall` events and emits raw feedback events with session snapshot | OpenClaw hook registration |
| Attribution Engine | Correlates a feedback event to the agent turn(s) responsible using session window | `attribute(feedback_event) → (turn_id, context)` |
| Feedback Analyzer | Subagent: infers sentiment + magnitude, generates hypothesis, optionally consults oracle | Subagent invocation; returns structured analysis |
| Candidate Synthesizer | Subagent: produces (prompt, rejected, chosen, reward) using oracle for chosen completion | Subagent invocation; returns DPO-shaped record |
| Oracle | Frozen higher-capability subagent: generates correct completions and rates session quality | Subagent invocation (configured externally) |
| Confirmation Handler | Presents hypothesis + candidate to operator; collects approval / rejection / edit | Feedback channel message round-trip |
| Training Buffer | Persists confirmed candidates as jsonl; manages held-out set | Append-only write; read by Training Scheduler |
| Training Scheduler | Cron: fires when buffer hits `min_candidates` or `max_interval`; invokes Unsloth | Cron trigger → Unsloth CLI |
| Deployment Gate | Runs delta eval on held-out buffer; blocks deployment if delta < 0 | `evaluate(model) → delta` |
| llama.cpp Adapter | Swaps active model on llama.cpp server | llama.cpp model-swap API |

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Oracle capability constraint | Oracle must be strictly higher-capability than the model under training, and frozen during the training cycle | If oracle ≈ trained model, chosen completions degrade over training iterations, producing circular or regressing signal |
| Deployment gate | Deploy only if delta eval on held-out buffer is ≥ 0 | Auto-deploying a regressing model silently degrades agent capability; the log alone is not a safeguard |
| Training buffer lifecycle | Clear consumed candidates after each training run; held-out set is frozen at initialization and never trained on | Accumulating stale candidates distorts loss; a held-out set that is also trained on produces a meaningless eval |
| DPO vs GRPO | TBD — resolves in Phase 0 | Data shape diverges at the candidate synthesizer; cannot finalize without Unsloth interface discovery |
| Positive signal path mechanism | TBD — resolves in Phase 0 | Success criterion undefined; unattended path carries buffer pollution risk |

---

## Constraints

- OpenClaw session history and tool call log primitives only — no external data injection into the pipeline
- Local model runs via llama.cpp server; no cloud inference for the trained model
- Oracle is a configured subagent, not hardwired — must be strictly higher-capability and frozen relative to training cycles
- All sentiment and magnitude inference is dynamic — no hardcoded mappings
- Operator confirmation is required for all negative signal candidates
- Deployment requires non-negative delta eval on a frozen held-out buffer
- Per-agent configuration: `feedback_window_turns`, `confidence_threshold`, `training_trigger`, `model_path`, `oracle_subagent`
