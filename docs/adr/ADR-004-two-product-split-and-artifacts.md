# ADR-004 — Two-product split: paid authoring + free offline reader; artifact-based delivery

**Status:** Proposed
**Date:** 2026-05-27
**Revises:** ADR-003 **D2** (reading is no longer Q's *own* in-app reader; it moves
to a separate app, and EPUB3 becomes the *primary* delivery artifact rather than an
"optional portable" one). Resolves ADR-003 open questions on *pricing/licensing*
and *reader location*.
**Amends SCOPE.md:** **D17** (no longer "free, no IAP" — the authoring app is
paid/subscription). **Reaffirms D1** (author still BYOK). Touches **D13/D14**
(formats / visual aids now compile into artifacts).

> **Amendment (ADR-005, 2026-05-29) — D6 money model superseded.** D6 below
> states the subscription "covers the app + upkeep only… never covers Anthropic
> token cost" because the author always BYOK. ADR-005 makes key handling
> **hybrid**: that statement now holds **only for the optional BYOK path**. For
> the **default managed path**, we hold provider keys and the subscription
> **includes a metered token allowance** (we carry vendor cost; pricing is
> margin-aware, per-plan caps). Accounts/auth + usage metering move to MVP. See
> ADR-005 D4/D5.

---

## Context

Through the content-migration work we clarified the actual product shape, which
differs from the single-app framing in `CLAUDE.md` / `SCOPE.md`:

- **Authoring** (this repo, "StudyBuddy Q") is where users/teachers *generate*
  study material and **compile it into an artifact**. It is **online** (calls
  Anthropic) and **paid** (subscription / purchase).
- **Reading** is a **separate, free-download application** — a general ebook
  reader (opens any EPUB/MOBI/PDF) that delivers **extra, interactive value when
  the book is ours**. It is **offline**.

This is a deliberate pivot, not a misread of the docs. It changes both the
*topology* (one app → two products) and two locked decisions (the money model and
where reading happens). ADR-003 had assumed Q itself was the interactive reader
with EPUB/PDF as a static side-export; that is now inverted.

The end goal that drives every decision below: **a learner reads our generated
content, interactively, offline, on Android/iPhone.**

---

## Decision

### D1 — Two products, one canonical source

| | **Authoring** | **Reader** |
|---|---|---|
| Repo | this one (`StudyBuddy_SelfLearner` / "StudyBuddy Q") | a **separate, new** app/repo |
| Role | generate content → **compile an artifact** | present artifacts; interactive with *ours* |
| Network | online (Anthropic) | **offline** |
| Money | paid / subscription / purchase | **free download** (value gated by the purchase) |
| Keys | **author BYOK** (D1 reaffirmed) | none — reads pre-compiled artifacts |

The existing `book.json` (structured TOC + per-topic `{lesson, tutorial?,
quizSets?, experiment?}`) is **demoted from delivery format to canonical internal
source**. Artifacts are *renderings* of it. There is exactly one content model;
formats are compile targets.

### D2 — Artifact targets: EPUB3 flagship, PDF print path, MOBI later

- **EPUB3 — flagship.** Carries our **interactive** layer (scripted content
  documents). This is the differentiated experience, unlocked in *our* reader.
- **PDF — the print path.** A **textbook compilation** (see D5), static.
- **MOBI — later / maybe.** Legacy Kindle; static; generated from the EPUB if/when
  demanded. Not in near-term scope.

### D3 — Interactivity is progressive enhancement, not a content property

One canonical source → one HTML/CSS rendering → behaviour degrades by destination:

| Destination | Maths / diagrams | Quizzes |
|---|---|---|
| **Our reader** (EPUB3 + interactive layer) | rendered, offline | **interactive: answer → reveal correct + explanation, score/progress tracked** |
| Generic EPUB reader | rendered, offline | **static answer key** (JS likely disabled) |
| PDF / print | rendered (fixed) | **static: Quizzes section + Answers section** (D5) |

Rationale: **EPUB3 *can* carry scripted content, but third-party readers commonly
disable JS** — so interactivity is only *guaranteed* in our reader. That guarantee
*is* the product's value proposition. Everything else falls back to a static
answer key; no content is ever lost, only interactivity.

### D4 — Pre-render maths and diagrams at compile time (kill the runtime CDN)

Today the renderer pulls `marked` / KaTeX / Mermaid from a CDN at *view* time —
fatal for offline and for EPUB/PDF. At **compile** time we instead bake:

- **KaTeX → MathML/HTML** (EPUB3 supports MathML natively; PDF gets it laid out).
- **Mermaid → SVG**.
- Markdown → XHTML.

Result: maths and diagrams display in **any** reader and on paper with **zero
runtime JS and zero network**. The *only* remaining script is the **optional**
interactive-quiz layer in the EPUB3 build. This is the single technical
prerequisite for the offline goal and it benefits every format at once.

### D5 — PDF is a textbook compilation, not a topic dump

The PDF is structured like a printed textbook:

1. **Front matter + Table of Contents with page-number index.**
2. **Chapter content** — each topic's lesson + tutorial, in order.
3. **Quizzes section** — *all* chapter quizzes grouped together, after the content,
   labelled by chapter.
4. **Answers section** — the correct answer (and explanation) for every quiz
   question, grouped by chapter.

This makes the PDF a coherent print/study artifact rather than a linear dump, and
cleanly separates "study the material" from "test yourself" from "check answers."

### D6 — Money: subscription/purchase gates the app + upkeep; author keeps BYOK

The paid subscription/purchase covers **the authoring app and its operation only**.
**It never covers Anthropic token cost** — the author still **brings their own key**
(D1/D9 reaffirmed; ADR-001 key-security discipline stands unchanged). The reader is
a **free download**; its value is gated by the author having paid for the app that
produced the book. This *amends SCOPE.md D17* ("free download, no IAP").

### D7 — The reader app builds on an existing EPUB engine

The reader opens *any* EPUB/MOBI/PDF — building that from scratch is a mini-Kindle
and would dwarf the rest. The reader app therefore rides on an established engine
(**Readium SDK / epub.js / foliate-js**, to be chosen in the reader repo) and adds
**our interactive overlay**: quiz interaction + **local, offline score/progress
tracking** (attempts stored on-device). Reading any third-party book "just works"
via the engine; our books "light up."

### D8 — Artifact generation runs server-side (authoring backend)

EPUB packaging (XHTML + CSS + JS + assets + OPF manifest + nav), PDF (headless
Chromium for fidelity), and MOBI (Calibre/kindlegen from the EPUB) are not client
work. They belong in a new **stateless** authoring-backend `export`/`artifacts`
service. It honours ADR-001 (no key in logs) — though note artifact *compilation*
itself needs no Anthropic key; the key is used only during *generation*, upstream.
The existing `contentHtml.ts` HTML/CSS is the seed for both the EPUB3 XHTML and the
PDF print stylesheet.

---

## Phasing

1. **Compile pipeline foundation** — canonical `book.json` → pre-rendered XHTML
   (MathML + Mermaid-SVG, no CDN). Shared by every target. (D4)
2. **EPUB3 export (static first)** — valid EPUB3 with pre-rendered content + nav +
   OPF; quizzes as static answer key. Opens in any reader.
3. **EPUB3 interactive layer** — scripted quiz (reveal + explanation) gated to run
   in our reader. (D3)
4. **PDF print compilation** — textbook layout: TOC+page index, content, Quizzes,
   Answers. (D5)
5. **Reader app (separate repo)** — pick engine; render our EPUB3; implement the
   interactive overlay + offline score/progress store. (D7)
6. **MOBI** — only if demanded. (D2)

---

## Open questions

- **Reader engine choice** — Readium SDK (native, robust, heavier) vs epub.js /
  foliate-js (JS, lighter, easier to extend with our overlay). Decide in the reader repo.
- **Interactive-layer transport** — how the EPUB3 signals "this is ours, enable
  interactivity" to the reader (manifest metadata / namespaced property / signed marker).
- **Progress model** — what we track (per-question attempts, per-quiz score,
  per-book completion) and its on-device schema; whether it ever syncs (later, optional).
- **PDF engine** — headless Chromium (fidelity, heavier infra) vs a PDF lib
  (lighter, lower fidelity for KaTeX/Mermaid).
- **Subscription mechanics** — store IAP vs external subscription; how the reader
  verifies entitlement for "our" interactivity while staying a free download.
- **Reader repo bootstrap** — new repo name, and how it consumes the artifact
  contract (does authoring publish a documented EPUB profile the reader targets?).

---

## Consequences

**Positive:** one canonical content model with clean compile targets; offline and
format-portability solved once (D4); interactivity is a guaranteed *differentiator*
of our reader rather than a fragile dependency; BYOK and ADR-001 untouched;
reusing the existing HTML renderer as the compile seed; reader leverages a mature
ebook engine instead of reinventing it.

**Negative:** real new surface — an artifact-compilation backend, EPUB3 packaging,
a print-grade PDF layout, and an entire *separate reader application*. The money
model changes (D17 amended), which has store/billing implications. Interactivity
now depends on a reader-side contract we must define and version.

---

## References

- ADR-003 (book authoring) — **D2 revised here**; pricing/reader-location open
  questions resolved here.
- ADR-001 (BYOK security) — **unchanged**; author still BYOK (D6).
- ADR-002 (vendoring) — unchanged.
- `docs/ARTIFACT_PIPELINE.md` — the per-format compile flow, the interactive-vs-static
  matrix, and a worked example (companion to this ADR).
- SCOPE.md §5 — D1 reaffirmed; **D17 amended**; D13/D14 now feed the compiler.
