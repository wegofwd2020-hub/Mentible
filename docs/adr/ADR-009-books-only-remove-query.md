# ADR-009 — Books-only: remove the Query single-lesson surface

**Status:** Accepted — 2026-06-05
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-003 (book authoring), ADR-004 (two-product split + artifacts),
ADR-007 (templates/theme). Amends locked decisions **D13** (output formats) and
**D16** (single-canvas Query UI); refines the mental model in `CLAUDE.md` /
`SCOPE.md`.
**Implemented by:** PR #72 (`feat(mobile): remove the Query tab and single-lesson
flow`). Pre-removal state preserved on branch `archive/query-feature`.

---

## Context

The app shipped **two** generation surfaces:

1. **Query** — a one-off *single lesson*. Type a topic, set the scope, generate,
   read it in an in-app lesson view; the most recent one is kept in a "last
   lesson" store. No persistence beyond that, no export.
2. **Books** — author a multi-chapter book: structure a table of contents,
   generate content per topic, then compile to an **EPUB3 / PDF** artifact with a
   cover (the deliverable, per ADR-004).

Query is a holdover from the original *"Claude Code, but for learners"* single-shot
framing. Since the **ADR-004** pivot — a paid **authoring** app whose product is a
compiled **artifact** delivered to a separate reader app — the centre of gravity is
book authoring. Query no longer fits:

- **It doesn't produce the product.** A Query lesson is ephemeral and in-app only;
  it never becomes an EPUB/PDF artifact, which is the thing the paid app exists to
  make (ADR-004).
- **Two surfaces, one engine.** Query and Books run on the *same* scoped-query
  engine; Query is a second UX/navigation surface to design, test, and document
  for no additional output capability.
- **Muddy product story.** "Quick single lesson" vs. "author a book" split the
  pitch. Demo/quality-first (D7) is better served by one focused flow.

Crucially, **Query is not a self-contained feature.** Its underlying engine is
shared: Books generates each topic through the same `POST /generate` endpoint and
the same request builder, params editor, and renderer. So this is a decision about
removing a **surface**, not the engine.

---

## Decision

**Mentible is Books-only.** Remove the Query single-lesson surface; keep the shared
scoped-query engine that powers per-topic book generation.

### D1 — Remove the Query surface (UI + single-lesson flow)

Removed as Query-exclusive:

- `mobile/app/(tabs)/query.tsx` — the Query screen
- `mobile/app/lesson/[jobId].tsx` (+ its route) — the single-lesson view (only
  reachable from Query)
- `mobile/src/storage/lessonStore.ts` — the "last lesson" store
- `mobile/src/hooks/useGenerateJob.ts` — lesson-job poll hook (orphaned once the
  lesson view is gone; Books polls via `pollUntilDone`)
- The `query` entry in `TopNavBar` and `(tabs)/_layout.tsx`

Navigation is now **Library · Books · Settings · Help · About**; the app still
lands on Library.

### D2 — Keep the shared scoped-query engine

These stay — removing them would break Books' per-topic generation:

- Backend `POST /generate` (and `/jobs/{id}` polling)
- `submitGenerate`, `getJobStatus`, `pollUntilDone`
- `buildGenerateRequest`, `GenerationParamsEditor` (also used by Settings and the
  book generate screen), `LessonRenderer` / `TopicRenderer`, `types/lesson`

### D3 — The scoped-query model is unchanged — it's still the IP

The six scope dimensions (topic, level, language, prior knowledge, format,
real-world framing) and the "scoped retrieval over the world of knowledge" mental
model remain the engineering IP. They now express themselves **per topic inside a
book** rather than as a standalone lesson. The product is still opinionated:
no free-form chat, scope enforced — that enforcement now lives in the book
authoring flow.

### D4 — Backend unchanged

No backend code was removed. `/generate` is the exact endpoint Books drives per
topic, so nothing was single-lesson-exclusive on the server. The output-format
concept from **D13** (Lesson / Explanation / Quiz) was only ever wired to
`format: "lesson"`, and lives on as per-topic content within a book — there is no
standalone single-format export.

---

## Consequences

**Positive**
- One generation surface to design, test, and document.
- Product story matches the product: you author books; the artifact is the output
  (ADR-004).
- Smaller mobile surface (screen, route, store, hook, test all gone) — fewer
  things to keep aligned with the engine.

**Costs / risks**
- No quick "just give me one lesson" path — to generate anything you now create or
  import a book first. Acceptable given the authoring-app positioning; revisit only
  if a lightweight single-artifact path is later wanted (it could be reintroduced
  as a one-chapter book rather than a separate surface).
- Docs that centred Query (D13, D16, the brand gloss "Q = Query") now read as
  historical; see the amendments below.

**Reversibility**
- `archive/query-feature` preserves `main` with Query intact; the engine it
  depended on is still present, so restoring the surface is a UI re-add, not an
  engine rebuild.

---

## Amendments to locked decisions

- **D13 (output formats — Lesson / Explanation / Quiz):** no standalone
  single-lesson generator. The format concept survives as per-topic content within
  books; only `lesson` is wired at MVP.
- **D16 (single canvas + collapsible side panel):** described the Query screen,
  which no longer exists. Book authoring uses the New Book → structure → editable
  topic tree → generate → publish flow (ADR-003), not the single canvas.
- **Mental model / brand gloss ("Q = Query"):** the scoped-query *model* is
  unchanged and remains the IP (D3 above); only the standalone Query *surface* is
  gone. (Public brand is already "Mentible" per ADR-006.)

---

## Open questions

- If a fast "one-off artifact" path is ever wanted, reintroduce it as a
  single-chapter book (reusing the authoring pipeline) rather than a second
  surface?
- Do the remaining `lesson`-named modules (`types/lesson`, `LessonRenderer`)
  warrant a rename to `topic`/`content` now that "lesson" is purely an internal
  per-topic shape? (Cosmetic; deferred.)
