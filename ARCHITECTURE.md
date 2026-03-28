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

<!-- Draw your system here. Show: external actors (users, services, APIs), internal modules, and the data flows between them. Arrows should indicate direction of data or control. -->

```
[replace this block with your diagram]
```

---

## Components

<!-- One row per module or major component. Name = the file or package. Responsibility = what it owns, in one sentence. Key interface = the public surface other modules call. -->

| Component | Responsibility | Key interface |
|---|---|---|
| | | |

---

## Design Decisions

<!-- Record decisions here as they are made. Each row is a choice that was non-obvious or that trades off competing concerns. Rationale should be specific enough that a future contributor understands why the alternative was rejected. -->

| Decision | Choice | Rationale |
|---|---|---|
| | | |

---

## Constraints

<!-- Non-negotiable limits on the system. Examples: platform requirements, runtime environment, compliance rules, external service dependencies, licensing. -->

-
