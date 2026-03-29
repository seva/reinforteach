# Discovery: llama.cpp Scoring for Deployment Gate

## Question

Given a `{prompt, chosen, rejected}` held-out candidate, how do we score how much the model prefers `chosen` over `rejected`? Required for `deployment_gate.py` `_default_scorer`.

## Approach: llama-cpp-python log-prob scoring

**Do not use the llama.cpp HTTP server.** `POST /completion` returns log-probs only for *generated* tokens — not for a fixed continuation (prompt tokens). The OpenAI-compatible `/v1/completions` endpoint supports `echo=true` + `logprobs`, but prompt token log-prob support is inconsistent across builds (open issue llama.cpp#8942).

**Use llama-cpp-python** (Python bindings) with `logits_all=True`. This gives reliable log-probs for any token in the input, including the continuation.

## Scoring method

For each held-out candidate `{prompt, chosen, rejected}`:

```
score(model, prompt, response) =
    mean(token_logprobs[prompt_len : prompt_len + response_len])
```

Where:
- `Llama(model_path=..., logits_all=True)` loads the model
- `create_completion(prompt + response, max_tokens=0, echo=True, logprobs=1, temperature=0)`
  returns `choices[0]['logprobs']['token_logprobs']` for all tokens
- Slice from `len(tokenize(prompt))` onward to get response token log-probs
- Average (not sum) — normalises for different chosen/rejected lengths

Per-candidate score:
```
margin(candidate) = score(model, prompt, chosen) - score(model, prompt, rejected)
```

Aggregate scorer output (for one model):
```
mean(margin) over all held-out candidates
```

Positive mean → model prefers `chosen` over `rejected` on average.

## Deployment gate use

- Baseline scorer: `scorer(None, held_out)` → load base model without adapter
- Candidate scorer: `scorer(adapter_gguf_path, held_out)` → load base model with LoRA adapter (`lora_path=adapter_gguf_path`)
- `delta = candidate_score - baseline_score`; deploy if `delta >= 0`

## Schema change required

`GateConfig` needs `model_path: str` so `_default_scorer` can load the base model.

`train_and_deploy.py` already has `PipelineConfig.model_path` — pass it through to `GateConfig`.

## Key constraints

- `logits_all=True` is mandatory — without it, log-probs are not computed for prompt tokens
- `temperature=0` — deterministic scoring; avoid stochastic noise in evaluation
- Length normalisation (mean not sum) — chosen and rejected completions may differ in length; sum would bias toward shorter responses
- Model loaded twice per gate evaluation (baseline + candidate) — expected, acceptable for batch step that runs once per training cycle
- `llama-cpp-python` added to ML deps (deferred until ML environment is pinned, consistent with `unsloth`/`trl` policy)

## Test strategy

Mock the `Llama` class. Inject a callable that returns a fake completion response with controlled `token_logprobs`. Verify:
- Scorer sums response-token log-probs correctly (slices from prompt_len)
- Scorer averages over candidates
- LoRA path passed to Llama constructor when adapter_path is not None
- Returns `None` adapter_path → Llama constructed without `lora_path`
