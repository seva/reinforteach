# Methodology

---

## Artifacts

| Artifact | Purpose |
|---|---|
| `CLAUDE.md` | Session bootstrap |
| `IMPLEMENTATION.md` | Task state — checkboxes updated in place |
| GitHub issue per phase | Failure record — comments capture attempts and decisions |
| `docs/` outputs | Phase 0 discovery artifacts — hard gates for dependent phases |

---

## Session Protocol

**Start:** Read `CLAUDE.md` → open linked GitHub issue → scan `IMPLEMENTATION.md` checkboxes.

**End:** Update checkboxes + post one comment to the open issue (what was tried, what was found, what's next).

---

## Commit Discipline

Commit at task completion, not session end. One logical unit of work per commit.

**Message format:**
```
<type>(<scope>): <summary>

Closes #N   ← for fix/feat commits that resolve a tracked issue
Refs #N     ← for commits that advance but don't close an issue
```

Rules:
- Every fix commit references its issue (`Closes #N` or `Refs #N`)
- Every phase completion is a commit
- Do not batch unrelated changes into one commit
- `IMPLEMENTATION.md` checkbox updates go in the same commit as the work they track
- Any commit that changes a component's public contract (function signatures, error types, endpoints, CLI interface) must update the corresponding section of `ARCHITECTURE.md` in the same commit

---

## Failure Handling

Any failure triggers the research sequence: **Hypothesis → online (docs + community) → source code.**

Do not retry without diagnosis. Do not proceed to the next task until the failure is understood.
Document findings as a comment on the open phase issue.

---

## Phase Gate

Discovery outputs (Phase 0) are hard prerequisites for implementation phases. No implementation code is written against undiscovered interfaces, APIs, or contracts.

---

## What Goes Where

- **Checkboxes** — task complete or not. Binary.
- **Issue comments** — everything else: failed attempts, decisions, partial findings, blockers.
- **`docs/`** — structured discovery outputs. Committed, permanent, readable by any session.
- **`CLAUDE.md`** — current phase pointer only. Updated when phase changes.
- **`docs/walrus-YYYY-MM-DD.md`** — WaLRuS-DATA session summary. Written at session end, committed.

---

## WaLRuS-DATA

At the end of any session with meaningful scope (phase completion, audit, significant fixes), write a `docs/walrus-YYYY-MM-DD.md` using the template at `docs/walrus-TEMPLATE.md`.

| Section | Content |
|---|---|
| **Wins** | What was completed and verified |
| **Learnings** | Non-obvious discoveries — API quirks, wrong assumptions corrected, surprises |
| **Risks** | Known latent issues, unverified assumptions, untested paths |
| **Strategy** | Where the project goes next and why |
| **Decisions** | Key choices made and their rationale |
| **Alignment** | Standing rules the project is now operating under |
| **Tradeoffs** | Accepted costs and why they were accepted |
| **Alternatives** | Options considered and rejected |

Keep entries concrete. No filler. Each line should be a fact a future session can act on.

---

## TDD

Tests are written before implementation code. Done means tests pass, not code written.

- Test files mirror source structure
- Each implementation task is preceded by a test task in `IMPLEMENTATION.md`
- Phase 0 (discovery) is exempt — no implementation code
- "Done" = the verification statement at the bottom of the phase is true

---

## What's Excluded and Why

- **Session log** — redundant with issue comments; grows noisy.
- **Branch-per-phase** — doesn't capture intra-phase progress or failures.
