# WaLRuS-DATA — 2026-03-28

Session scope: Post-context-compaction session — methodology update (Post-Phase Audit reinstated), post-Phase-4 audit, gap closure.

---

## Wins

- Reinstated Post-Phase Audit gate from seva/epistegrity#4 into `METHODOLOGY.md`; now a standing step between phase completion and WaLRuS
- Post-Phase 4 audit completed: all ARCHITECTURE.md component interfaces verified against code — all match
- 11 new tests added, closing all coverage Gaps: 8 in `config_loader.test.ts` (untested validation throw branches), 3 in `test_gguf_conversion.py` (LLAMACPP_DIR not set, LLAMACPP_DIR path construction, OSError in `_validate_gguf_header`)
- All Python subprocess/integration Acceptable paths documented in ARCHITECTURE.md Coverage Notes (7 new rows)
- `.pytest_cache/` added to `.gitignore`
- 102 TS + 18 Python tests, all green

## Learnings

- v8 coverage truncates long uncovered-line lists with `...` — always read the actual file at those line numbers; the truncation hides earlier gaps
- `gguf_converter.py` has two distinct error paths for missing convert_script: LLAMACPP_DIR not set (lines 36–40) vs file unreadable post-conversion (lines 65–66) — both are boundary conditions at different stages of the function, both worth separate tests
- Post-Phase Audit consistently finds real issues (this session: 8 test gaps + `.pytest_cache/`). The gate adds real value — not process overhead

## Risks

- `_default_scorer` in `deployment_gate.py` raises `NotImplementedError` — no live scorer until Phase 5
- Phase 3 and 4 verification statements (E2E live runs) remain unverified — all tested components are exercised in isolation; no live llama.cpp or OpenClaw agent has run the full pipeline
- `training_scheduler.ts:startCron` and real `spawnTrainAndDeploy` subprocess paths not tested with a live process
- TypeScript pipeline components (feedback_capture → attribution → analyzer → synthesizer → confirmation → buffer) are tested in isolation; no assembly module connects them in the plugin context yet

## Strategy

Phase 5 — Plugin Assembly & Live Wiring. Two goals: (1) wire all TypeScript pipeline components into a single plugin entry point that can run end-to-end under OpenClaw; (2) implement the real llama.cpp scorer for the deployment gate. Both are prerequisites for any live verification. Scorer approach needs discovery first (llama.cpp log-prob support is undocumented in Phase 0 docs).

## Decisions

- Post-Phase Audit is a standing gate before the WaLRuS — not optional, runs after every phase completion
- `config_loader.ts:32-33` (unreachable throw) classified Acceptable rather than removed — keeps TypeScript exhaustiveness pattern visible; the comment in source explains the invariant; removing it adds no safety value

## Alignment

- Post-Phase Audit (interfaces, coverage, cross-cutting) precedes the WaLRuS
- Coverage gaps must be closed or explicitly documented as Acceptable before committing phase done
- All Acceptable uncovered paths must have a row in `ARCHITECTURE.md` Coverage Notes with a `Reason` that explains why live/subprocess coverage is infeasible

## Tradeoffs

- Testing `gguf_converter.py:41` (LLAMACPP_DIR-set path) with `monkeypatch.setenv` — adds a test that verifies path construction from an env var; minor overhead but the env-var code path had zero coverage and is distinct behavior

## Alternatives

- Considered grouping all Python subprocess/integration Coverage Notes into a single "all main() entry points" row — rejected; one row per file makes individual files' status clear when skimming the table
- Considered not testing `config_loader.ts` validation branches beyond the two already tested (missing `adaptive_learning`, missing `model_path`) — rejected; each guard is an independent check with a specific error message; if one is broken, only a test for that field would catch it
