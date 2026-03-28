# WaLRuS-DATA — 2026-03-28

Session scope: Phase 1 — Feedback Capture & Attribution complete; audit findings resolved; session adapter introduced.

---

## Wins

- `src/plugin/feedback_capture.ts`: `handleMessageReceived` / `handleAfterToolCall` pure handlers with runtime validation; `ValidationError` on malformed payloads; OpenClaw hook registration
- `src/attribution.ts`: `attributeFeedback` with injected `readTranscript`; session lookup by `origin.from` or `sessionKey`; archived transcript fallback for post-reset attribution; `ReadFailedError` caught → returns null
- `src/errors.ts`: `ValidationError`, `ReadFailedError`, `NotFoundError` explicit error hierarchy
- `src/session_adapter.ts`: `toSessionEntry(host, listFiles)` adapter isolating OpenClaw schema from domain type; derives `archivedTranscripts` via prefix scan; sorted oldest-first
- `vitest.config.ts`: stub config; `*.test.ts` naming established
- 26/26 tests green after audit fixes

## Learnings

- pytest-style `test_*.ts` naming yields zero files in Vitest — default glob is `*.{test,spec}.ts`; silently exits with code 1
- `as` casts in TypeScript event hooks are silent failure points at runtime — assertion functions (`asserts event is T`) needed at every hook ingress
- `archivedTranscripts` field doesn't exist in OpenClaw's real `SessionEntry` schema — it's derived from filesystem glob on `{sessionFile}.reset.*` pattern
- epistegrity IMPLEMENTATION.md template had test task order reversed (impl before test) and used `test_*.py` as a generic example — both corrected upstream

## Risks

- Live capture verification not done — integration path (hook fires → `handleMessageReceived` → `attributeFeedback` → log entry) structurally sound but unverified end-to-end against a running gateway
- `register()` in plugin untested — requires a mock or live OpenClaw API object; classified as Acceptable gap

## Strategy

Phase 2 (Candidate Pipeline) begins with feedback analyzer. All Phase 2 modules inherit the injected-dependency pattern established here. Real I/O wrappers (OpenClaw gateway calls, `fs`) written at integration time — not in Phase 2.

## Decisions

- Pure handlers separated from hook registration: testable logic without gateway dependency
- `readTranscript` injected rather than importing `fs`: no Node built-in mocking needed
- `sessionKey` direct-match for tool_call events: already present in hook context; no origin lookup needed
- Injected dependencies at every I/O boundary: established as project-wide convention

## Alignment

- All I/O dependencies injected — no direct `fs` or gateway imports in testable modules
- TypeScript test files named `*.test.ts`
- Coverage as diagnostic: known acceptable gaps documented in `ARCHITECTURE.md` Coverage Notes

## Tradeoffs

- Injected deps over direct `fs` imports: fully testable without Node mocks — cost: real integration wrappers deferred to integration phase
- Separating pure handlers from plugin registration: clean unit tests — cost: `register()` path untested; hook wiring verified only at live integration

## Alternatives

- Mocking Node's `fs` module in tests: rejected — couples tests to implementation details; fragile under refactor
- Testing `register()` with a mock OpenClaw API object: deferred — adds complexity without exercising meaningful logic; the pure handlers are the contract
