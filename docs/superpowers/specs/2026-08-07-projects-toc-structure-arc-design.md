# Projects — Structured (TOC-driven) authoring — ARC DESIGN

**Status:** Approved shape (brainstorming, 2026-08-07). This is the **arc/reference doc** for a
multi-slice effort; each slice gets its own spec → plan → SDD. Slice A is specced alongside this.

**Context:** ADR-037 trust Project workspace. Prompted by Sridhar's 2026-08-07 test-run feedback
([[feedback_sridhar_testrun_2026-08-07]]) and a design challenge: bring Studio's "Structure TOC"
behaviour into Projects so the author builds a visible, editable outline from their sources before
generating — fixing wayfinding (#2) and thin drafts (#3) structurally.

## The reframed Projects flow (book/essay projects)

A cornerstone-book-centric flow with a new **Structure** phase:

```
Input (sources, editable) → Structure (TOC) → Create (generate PER TOPIC)
   → Validate (approve PER TOPIC) → Publish (assemble → Library/EPUB/PDF)
```

Social/derivative formats are unaffected — they still derive FROM the finished/validated book
(ADR-037 Capture→Create→derivatives). The Structure phase is **book/essay only**.

## Locked decisions (brainstorming 2026-08-07)

1. **Validation unit = per topic.** A book owns an ordered set of **topics**; **each topic has its
   own version stream + approval** (the existing `artifact_version` + `approval` machinery, reused
   per topic). The **book is "validated" when every topic has an approval.** Editing one topic
   re-versions only that topic (small re-approval blast radius). Exact schema (topics as rows under a
   book artifact vs topic-as-artifact) is a **plan-time decision for Slice C** — the invariant is
   "validate topic-by-topic, assemble the book."
2. **TOC genesis = blank + Suggest-from-sources.** Start empty; add topics manually AND/OR press
   "Suggest outline from sources" (LLM reads the project's **sources** → a `StructuredTOC`, grounded
   — *invent nothing beyond the sources*). Always hand-editable (edit/delete/reorder). Thin sources →
   thin TOC = a visible **coverage signal**.
3. **Format scope = book/essay only** get the Structure phase; social derives from the book.
4. **Source editability folded in** (Sridhar #1): view/edit/delete sources with a "cited by a
   version?" guard. **This is Slice A** (standalone, ships first).

## Cross-slice invariants (every slice must hold these)

- **Grounding unchanged:** everything (Suggest-outline included) draws ONLY from the provided
  sources — *invent nothing*. A suggested topic must be supported by source content.
- **Provenance:** generated topic content cites `source_ids` (topic-scoped). A source cited by a
  validated draft cannot be silently deleted/edited (Slice A's guard).
- **Reuse, don't rebuild:** Studio already has `mobile/src/components/TopicTreeEditor.tsx`
  (add/edit/delete/reorder), `mobile/src/hooks/useStructureJob.ts` + `POST /structure`
  (raw text → `StructuredTOC`), and the `Book`/`StructuredTOC`/`TopicNode` types
  (`mobile/src/types/book.ts`). Slice B reuses the editor; the Suggest endpoint mirrors `/structure`
  but reads project sources.
- **Doesn't blur the two products:** this borrows Studio's *structuring UX*, but Projects keeps its
  two differentiators — **grounding** (sources only) and **validation** (expert approval). See the
  Studio-vs-Projects diagram.
- **Reuse the assembly bridge:** Publish assembly (Slice D) extends the shipped `artifactToBook`
  (#379) from one artifact → a multi-topic book.

## Decomposition (build one at a time; each a working increment)

| Slice | Delivers | Depends on | Size |
|---|---|---|---|
| **A — Source editability** | view-full + edit + delete a source; backend `PATCH`/`DELETE /inputs/{id}` + cited-guard | — | small (specced now) |
| **B — Structure phase + TOC** | new Structure phase; `TopicTreeEditor` reuse; **Suggest-from-sources** endpoint; persist a project TOC; `<Next>` gate | A (nice-to-have) | medium |
| **C — Per-topic generate + validation** | the per-topic trust model — topics as validatable units, generate-per-topic, book-validated-when-all-approved | B | large (the crux) |
| **D — Publish assembly** | validated topics → multi-topic book → Library/EPUB/PDF (extends #379) | C | medium |

Each slice is shippable on its own: A fixes a live bug; B gives the visible outline (wayfinding);
C delivers depth + granular trust; D produces the deliverable.

## Deferred / open (resolved in per-slice specs, not here)

- **Slice C schema:** topics-as-rows (`artifact_topic` + `topic_id` on version/approval) vs
  topic-as-artifact (reuse everything, add a book-container). Decide in Slice C's spec.
- **Book "validated" rule:** all topics approved (baseline) vs a threshold. Slice C.
- **TOC persistence shape** (Slice B): a `toc` column on the project/cornerstone artifact vs a
  `topic` table. Slice B.
- **Suggest-outline contract** (Slice B): topics + per-topic `source_ids` coverage; grounded prompt.

## First build: **Slice A** — see `docs/superpowers/specs/2026-08-07-slice-a-source-editability-design.md`.
