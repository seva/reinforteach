# reinforteach

An RLHF-style pipeline that converts operator feedback on OpenClaw agent turns into DPO/GRPO training signal for local models running under OpenClaw.

## Session Start

1. Read `METHODOLOGY.md`
2. Read `ARCHITECTURE.md` — verify component descriptions match current code before acting
3. Scan `IMPLEMENTATION.md` checkboxes — first unchecked task is current state
4. Check open GitHub issues for failures and decisions
5. Search memory for relevant prior knowledge

## Conventions

- **Languages:** TypeScript (Node.js 24) for pipeline; Python 3.12 for ML components (dpo_runner, gguf_converter, deployment_gate)
- **Language boundary:** `training_scheduler.ts` → subprocess → `dpo_runner.py`. Handoff is file paths on disk.
- **TypeScript test runner:** Vitest — `npx vitest run` (all), `npx vitest run tests/path/to/file.test.ts` (single); test files named `*.test.ts`
- **Python test runner:** pytest — `python -m pytest` (all), `python -m pytest python/tests/path/test_file.py` (single)
- **Plugin loading:** OpenClaw loads TypeScript plugins directly — no build step. Entry point declared in `package.json` under `"openclaw": { "extensions": [...] }`.
- **ESM:** `"type": "module"` throughout; use `.js` extensions in TypeScript imports (Node ESM requirement)
