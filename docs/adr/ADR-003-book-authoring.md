# ADR-003 — Book Authoring (StudyBuddy Q grows up)

**Status:** Proposed
**Date:** 2026-05-26
**Supersedes/relocates:** StudyBuddy_OnDemand ADR-002 (EPUB/reading) + ADR-003
(standalone packaging), per OnDemand ADR-004 D5 ("Q grows up: book authoring").

---

## Context

OnDemand ADR-004 decided that the **standalone, BYOK, individual "author your own
book + read it"** product belongs in **StudyBuddy Q**, not the school platform,
and resolved the scope question: **Q grows up from single-artefact to multi-topic
book authoring.** A working prototype was built inside OnDemand (the "Curriculum
Authoring Studio") that proved the workflow:

> paste a free-text TOC → structure it (LLM) + advisory flow analysis →
> edit the topic tree → generate content per topic (lesson/tutorial/quiz, with
> Mermaid diagrams) → review / regenerate-with-reason → snapshot/restore →
> publish.

**This is a re-conception, not a code transplant.** That prototype is a Next.js
admin console on **Postgres + RLS + Celery + super_admin auth** — none of which
fits Q. Q is **mobile-first (RN/Expo), Redis-only (no DB at MVP), single-user,
BYOK, stateless backend, device-local storage.** What we reuse is the **prompt IP
(already vendored), the workflow design, and the renderer approach** — reimplemented
on Q's stack and honoring Q's ADR-001 (BYOK) and ADR-002 (vendoring).

Q today (`feat/mobile-skeleton`): single-lesson generate (`/generate` + `/jobs`),
device lesson library (AsyncStorage), `LessonRenderer` (KaTeX/Mermaid/GFM), PDF
export. Q's MVP/auth/library are still landing — **book authoring is Q's next
major phase, sequenced after the single-lesson MVP stabilises.**

---

## Decision

### D1 — Books are local-first; the backend stays stateless

A **book** (title, structured TOC, per-topic generated content, versions,
snapshots) lives **on the device** (AsyncStorage now; on-device SQLite if books
outgrow AsyncStorage's quota), exactly like today's lesson library. The backend
remains a **stateless BYOK generate service** — no server DB, no Postgres, no
per-user persistence. This preserves Q's privacy/BYOK ethos and ADR-001, and is
the "local-first" shape OnDemand ADR-003 recommended.

### D2 — Reading is interactive (Q's own reader)

The reader is Q's app, so quizzes stay **interactive** and math/diagrams render
live (resolving OnDemand ADR-002 R1's tension). A **static EPUB/PDF export**
remains an optional *portable* artefact (quizzes flatten to an answer key) — not
the primary experience.

### D3 — Backend: extend the stateless generate service (BYOK per request)

New **stateless** endpoints, each following the ADR-001 envelope + redaction
discipline (api_key in body, encrypted in Redis, shredded after use, never
logged):

- `POST /structure` — free-text TOC → structured `{subjects→units→subtopics,
  prerequisites}` (LLM).
- `POST /flow-check` — advisory pedagogical-flow analysis over a structured TOC.
- Reuse/extend `POST /generate` for per-topic content; add `tutorial` / `quiz`
  formats and a "unit N of M" scope binding for book context.

The cheap deterministic ordering check can run **client-side** (no key, no cost).
Batch "generate all topics" is a **client-orchestrated loop** over `/generate`
(reusing job polling) — keeps the backend stateless; no batch tables.

### D4 — Client: a book-authoring surface (mobile + Expo-web)

New screens + a device book-store, reusing the existing generate/poll/render/PDF
machinery:
- Create book + paste TOC → call `/structure` → **editable topic tree**.
- **Generate all** (client loop with progress) → store per-topic content + version
  history on device.
- **Per-topic review**: view via `LessonRenderer`, **regenerate-with-reason**,
  accept; **snapshots/restore**; **publish** (finalise) → **export** (PDF now;
  EPUB later, static).

### D5 — Reuse via vendoring, never cross-import (ADR-002)

Continue vendoring the prompt IP from OnDemand. The authoring prompt builders
(`toc_structurer`, `flow_analyzer`) currently live in OnDemand's `pipeline/`;
**vendor or reimplement** them here (single-provider, BYOK), recording SHAs in
`VENDORED.md`. Never import from `../StudyBuddy_OnDemand/`.

---

## Phasing

1. **Q MVP first** — let single-lesson generate + library + (v1.1) auth stabilise.
2. **Authoring Phase 1** — `/structure` + client topic-tree editor + `generate-all`
   loop + device book-store + per-topic review/regenerate (reusing `LessonRenderer`).
3. **Authoring Phase 2** — snapshots/restore, flow analysis, publish + full-book PDF.
4. **Authoring Phase 3** — static EPUB export (pre-rendered Mermaid SVG + MathML).

---

## Open questions

- **Book storage tech** — AsyncStorage vs on-device SQLite (books are larger than
  single lessons; versions/snapshots multiply size).
- **Pricing/licensing** — one-time vs subscription for the paid Studio (OnDemand
  ADR-003 D4, still open); reading stays free regardless.
- **Auth/cloud-sync dependency** — local-first means book authoring needs no auth;
  cloud sync (multi-device book backup) is a later, optional add.
- **Authoring prompt builders** — vendor from OnDemand vs reimplement for the
  single-provider BYOK shape.

---

## Consequences

**Positive:** keeps Q local-first/BYOK/stateless-backend; reuses generate + render +
PDF + prompt IP; interactive reading; no server DB or per-user infra.
**Negative:** real new surface (book model, device store, authoring screens, batch
orchestration, export); a re-implementation, not a transplant; expands Q's scope
beyond the "single artefact" MVP (deliberately — ADR-004 D5).

---

## References

- OnDemand ADR-004 (home-repo decision, D5 resolved), ADR-002/003 (superseded here).
- Q ADR-001 (BYOK security model), ADR-002 (vendoring).
- OnDemand Authoring Studio (prototype): the workflow proof; PRs #383–#395.
