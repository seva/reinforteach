# WaLRuS-DATA — 2026-03-28

Session scope: Phase 3 — Training & Deployment complete; all five modules built and tested.

---

## Wins

- `src/training_scheduler.ts`: `createScheduler` with count + interval triggers, re-entrancy guard (`isTraining` set before first await), `startCron` wrapper; 7/7 tests
- `src/dpo_runner.py`: reads `training_buffer.jsonl`, min-candidates gate, Unsloth DPO pipeline; all ML deps injectable; `pyproject.toml` configures pytest `pythonpath = ["src"]`; 2/2 tests
- `src/gguf_converter.py`: shells out to `convert-lora-to-gguf.py`, GGUF magic header validation (`b"GGUF"`), `ConversionError` on bad header or nonzero exit; 4/4 tests
- `src/deployment_gate.py`: scorer injection pattern, delta eval, deploy/block decision at `delta >= 0`, `_default_scorer` raises `NotImplementedError` to force injection; 4/4 tests
- `src/lora_deployer.ts`: `POST /lora-adapters` with `[{id, scale}]` body, success logging, error handling for HTTP failures and network errors (no crash); 5/5 tests
- 87 tests total (77 TS + 10 Python), all green

## Learnings

- `isTraining = true` must be set before any `await` in `tick()` — otherwise two concurrent calls both pass the re-entrancy check before either sets the flag (Node.js event loop is single-threaded but microtask boundaries are not atomic)
- Python ML deps (Unsloth, trl, datasets) cannot be imported in test environments without GPU/torch — lazy imports inside functions (not at module top) are required for the injectable pattern to work
- pytest `pythonpath` option (7.0+) is the clean way to add `src/` to sys.path — no `sys.path.insert` needed in test files
- GGUF magic is exactly `b"GGUF"` (first 4 bytes) — sufficient for header validation; no version check needed at this stage
- `_default_scorer` raises `NotImplementedError` rather than returning a stub — this is an explicit forcing function that prevents silent bugs if the real scorer is forgotten at integration time

## Risks

- Real scorer for deployment gate deferred — `_default_scorer` raises `NotImplementedError`; integration requires a live llama.cpp server and a scoring strategy (DPO preferred-response rate is the natural signal)
- `convert-lora-to-gguf.py` path resolved via `LLAMACPP_DIR` env var — not set at test time (injected); must be configured at integration time or the gate raises
- `training_scheduler.ts` real `runTraining` not wired — `startCron` sets up the interval but the real subprocess call chain (scheduler → dpo_runner → gguf_converter → deployment_gate → lora_deployer) is not assembled; integration wiring is Phase 4
- `deployment_gate.py` scorer is a stub — the real eval strategy (comparing chosen/rejected preference rates on held-out prompts) is not implemented; design TBD at integration time

## Strategy

Phase 3 is done. All five components are individually tested. Integration wiring — subprocess chains, env vars, scorer implementation, live llama.cpp verification — is the next phase. The verification statement in IMPLEMENTATION.md (seed buffer → training run → adapter.gguf → delta eval logged → adapter active on llama.cpp) requires live infrastructure. Until then, unit coverage is complete. Post phase comment on issue #5.

## Decisions

- `createScheduler` factory pattern (not class): consistent with TS injection pattern; `startCron` is the untestable wrapper (documented acceptable gap)
- `isTraining` set synchronously before first `await`: prevents TOCTOU race on the re-entrancy guard in Node.js's single-threaded event loop
- Python ML deps lazy-imported inside functions: allows the entire module to be imported in test environments without torch/GPU
- `_default_scorer` raises `NotImplementedError`: forces explicit scorer injection rather than silently passing with a placeholder that would give meaningless deltas
- `pyproject.toml` with `pythonpath = ["src"]`: canonical pytest config, no per-file path hacks
- `ConversionError` in `gguf_converter.py` (Python-local error type, not reusing TS `ValidationError`): Python components have their own error hierarchy; no cross-language error inheritance

## Alignment

- Injected dependency pattern extended to Python components: `model_loader`, `trainer_factory`, `run_subprocess`, `scorer` all injectable
- Acceptable coverage gaps documented: `startCron`, `_default_scorer`, Python lazy imports — same policy as Phase 1/2
- Python tests use `test_*.py` naming; pytest configured via `pyproject.toml`
- Every component test-first; done = tests pass, not code written

## Tradeoffs

- Lazy imports in Python (not top-level): testable without GPU — cost: import errors for missing ML deps surface at call time, not at module load; `type: ignore[import]` required
- `_default_scorer` as `NotImplementedError`: explicit forcing function — cost: deployment gate is not runnable end-to-end without implementing the scorer; forces integration work
- GGUF header check only (4 bytes): minimal, fast validation — cost: does not detect truncated or corrupt GGUF bodies; full validation would require parsing the GGUF format spec

## Alternatives

- Class-based scheduler (vs factory): rejected — no advantage over closure for this use case; factory is consistent with Phase 1/2 injection patterns
- Top-level ML imports with conditional mock: rejected — couples tests to implementation details; lazy imports + injection is cleaner
- Full GGUF validation (parse header fields): deferred — llama.cpp rejects malformed GGUFs gracefully; the 4-byte magic check catches the most common failure (wrong file) without requiring a GGUF parser
- Scorer as separate subprocess (vs injectable function): deferred — would simplify the Python/TS boundary but adds subprocess overhead on every evaluation; inline injection is sufficient for v1
