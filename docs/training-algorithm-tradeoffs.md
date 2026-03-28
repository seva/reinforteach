# Discovery: DPO vs GRPO — Pipeline Tradeoffs

## The core divergence

DPO and GRPO differ at the **data layer**, not just the training algorithm. This affects where the oracle is invoked and what the training buffer stores.

| | DPO | GRPO |
|---|---|---|
| Buffer record shape | `(prompt, chosen, rejected)` | `(prompt, answer)` |
| When oracle is invoked | At candidate collection time | At training time (as reward function) |
| What oracle produces | One "chosen" completion | A scoring function over N generated completions |
| Operator confirmation applies to | The (chosen, rejected) pair | The `answer` ground truth |
| Training-time oracle calls | None | `num_generations` × `batch_size` per step |

---

## DPO

### How it maps to this pipeline

The candidate synthesizer as designed produces `(prompt, rejected, chosen, reward)` — this is DPO-shaped. Oracle work is done once at collection time:

```
operator feedback
  → attribution → feedback analyzer → oracle generates chosen completion
  → operator confirms (prompt, rejected, chosen)
  → appended to buffer as jsonl record
  → training run reads buffer, trains on static preferences
```

The `reward` field (`sentiment × magnitude`) doesn't directly feed DPO training (DPO uses `beta` to scale preference strength, not per-sample weights). It can be used for **candidate filtering** (reject low-confidence pairs before training) but is not a required DPO input.

### Tradeoffs

**Advantages:**
- Oracle runs once per candidate — predictable cost
- Buffer is self-contained; training needs no live dependencies
- Simpler deployment: train offline, swap model/adapter when done
- Candidate synthesizer design in spec maps directly to DPO format

**Disadvantages:**
- Oracle must produce a single deterministic "correct" completion — may be brittle for open-ended tasks
- Preference labels are frozen at collection time; if the oracle improves, old labels don't update
- `reward` (sentiment × magnitude) is unused by the trainer — collected but not trained on as a continuous signal

---

## GRPO

### How it maps to this pipeline

GRPO requires the oracle to be available **at training time** as a reward function. The buffer does not store preferences — it stores prompts and ground truth context:

```
operator feedback
  → attribution → feedback analyzer → oracle provides answer/ground-truth
  → operator confirms (prompt, answer)
  → appended to buffer
  → training run: model generates N completions per prompt, reward_fn(oracle) scores each
```

The `sentiment × magnitude` reward from the feedback analyzer maps naturally to GRPO's continuous reward signal — this is a better fit for the reward field than DPO.

### Tradeoffs

**Advantages:**
- Continuous reward signal; `sentiment × magnitude` directly usable
- Oracle doesn't need to produce a single "correct" completion — it scores quality, which is more reliable for open-ended tasks
- Training adapts to oracle quality over time (if oracle improves, the reward function improves)
- Better suited for behavioral fine-tuning (follow instructions better) vs. factual fine-tuning

**Disadvantages:**
- Oracle must be live and callable during every training step — adds latency and cost
- `num_generations` × `batch_size` model completions per step → significantly heavier training
- Requires vLLM or equivalent for efficient generation at training time (`use_vllm=True` in GRPOConfig)
- Buffer format is different from DPO — can't reuse the same buffer for both without a conversion layer
- More complex reward function engineering: must map `(completions, answer)` → `list[float]` reliably

---

## Decision recommendation

**Use DPO for Phase 1.** Rationale:

1. The candidate synthesizer as designed produces DPO-shaped records — no pipeline redesign needed.
2. Oracle at collection time is cheaper and more predictable than oracle at training time for a locally-running system.
3. GRPO requires vLLM + live oracle during training — significant infrastructure overhead for a first implementation.
4. The `reward` field (sentiment × magnitude) can gate candidate quality (filter low-confidence pairs) even if DPO doesn't use it as a continuous signal.

**Defer GRPO to a later phase** once DPO is validated and if continuous reward signal proves more important than the cost/complexity increase. The buffer format would need a conversion layer or separate buffer path.

---

## Deployment path (both algorithms)

Regardless of algorithm choice: output a **LoRA adapter** (`model.save_lora()`), not a full GGUF. Deploy via `POST /lora-adapters` on the llama.cpp server — instant swap, no model reload. Reserve full GGUF export for major version checkpoints.
