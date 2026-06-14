# docs/

Project documentation for **StudyBuddy Q**.

## Index

| Doc | Read when |
|---|---|
| `../SCOPE.md` | First — full scope decisions, why each was made |
| `../CLAUDE.md` | Durable spec — repo conventions, layer rules, pitfalls |
| `MVP_v1.md` | What's actually being built first |
| `STATUS.md` | What's actually built so far (progress vs. the plan) |
| `QUALITY_GATES.md` | The compliance + quality gates we enforce on curated content, and where each is surfaced (reader · auditor · product) |
| `adr/ADR-001-byok-security-model.md` | Before touching any code that handles the API key |
| `adr/ADR-002-repo-structure-and-vendoring.md` | Before importing or copying from StudyBuddy_OnDemand |

## Architecture diagrams (planned, not yet drafted)

Per the global standard (Rule #17 in `~/coding-standards/CODING_RULES.md`),
this project will eventually maintain a subset of the 11 standard diagrams.
At MVP only diagrams 1–3 are needed:

- [ ] System Design (mobile · backend · Anthropic)
- [ ] Component Diagram (mobile screens · backend modules · vendored pipeline)
- [ ] Service Dependencies (sync HTTP, push via FCM)

Defer diagrams 4–11 until production deployment is in sight.

## ADR index

| # | Title | Status |
|---|---|---|
| ADR-001 | BYOK Security Model — Pattern B (Per-Request Passthrough) | Accepted |
| ADR-002 | Repo Structure & Vendoring Strategy | Accepted |
