# ADR-041 — Portability-first: tiered EPUB exports (EPUB 2 + EPUB 3) + a standalone EPUB 3 viewer

**Status:** Proposed (2026-08-18). Records the **strategic decision and its reconciliations only — no code.** The two initiatives decompose into their own specs/plans (and, for the viewer, likely its own repo) when taken up.
**Decision-maker:** Sivakumar Mambakkam
**Trigger:** After library-carried audio (ADR-040 rung 2) made book content EPUB 3-only in places, the question "are we still EPUB 2 compatible?" surfaced a broader direction call. The decision: **lean into portability as a first-class product value** — offer books in multiple EPUB tiers *and* ship a standalone viewer, so Mentible content travels and reads widely, not only inside our own reader.
**Relates to / amends:** ADR-004 (two-product split; the free reader app D1 + "reader rides an existing engine" D7), ADR-040 (multi-modal library / "only our reader renders" moat), the KDP export profile (`docs/specs/kdp-clean-export-profile.md`), and the north-star memory `project_product_vision_multimodal_library`.

---

## Context

Two facts collided:
- **Our exports are EPUB 3.** The compiler emits a `version="3.0"` package (`compiler/src/epub.ts`) with a `toc.ncx` backward-compat gesture. Rung-2 audio and the animated-SVG diagrams are **EPUB 3-only** content — an EPUB 2-only reader opens the file (via the ncx) and reads text, but can't render the rich media. See ADR-040 §Format compatibility.
- **The recorded moat leans the other way.** ADR-040 / the north-star frame the differentiator as *"multi-modal audio/graphics books that **only our reader** renders fully."* Portable exports + an open viewer make the content readable **elsewhere**, which is in tension with a lock-in moat.

The decision resolves that tension deliberately in favor of **reach**.

## Decision

**Portability is a first-class feature. Mentible content should travel widely — offered in multiple EPUB tiers and openable in a standalone viewer we ship — with the differentiator reframed from "only our reader can open it" to "our reader renders it *best*."**

Concretely, two initiatives (each its own later spec/plan):

### Initiative A — Tiered EPUB exports (a strict EPUB 2 profile alongside EPUB 3)
Add a third compiler profile to the existing `"default" | "kdp"` enum: **`epub2`** — a strict, validation-clean **EPUB 2.0.1** artifact for genuinely old readers. Because EPUB 2 (XHTML 1.1, no HTML5) cannot carry the rich media, the `epub2` profile is a **deliberate lossy downgrade**, reusing the KDP profile's degradation machinery where it overlaps:
- **Strip audio** — `<audio>` is EPUB 3-only; drop it (optionally leave the `transcript` text so narration content survives as prose).
- **Raster math** — MathML → PNG `<img>` (reuse the KDP `mathRaster` path).
- **Flatten animated SVG** — the animated-diagram figures → a static frame / raster (no `<animate>`; EPUB 2 has no SMIL-in-content story).
- **EPUB 2 package** — `version="2.0"` OPF, NCX as the *primary* nav (no `nav.xhtml` reliance), EPUB 2 core-media-types only.
- Ships **behind a distinct "EPUB 2 (max compatibility)" export action**, next to the existing rich EPUB and KDP exports. The rich **EPUB 3** stays the default. epubcheck (EPUB 2 profile) is the validation gate, mirroring the KDP epubcheck discipline.

### Initiative B — A standalone EPUB 3 viewer users can download
Ship a **standalone reader that opens EPUB 3 (any publisher's, not only ours)** and renders Mentible's rich media (audio, animation) at full fidelity. **This is ADR-004's free reader app (D1), elevated from deferred to active and reframed portability-first** — not a brand-new concept. ADR-004 D7's constraint is **binding and load-bearing here:** the viewer **rides an established EPUB engine (e.g. Readium / epub.js / foliate-class), NOT a reader built from scratch** — building a generic EPUB engine from zero is "a mini-Kindle" that would dwarf the rest of the product. The viewer's *added* value over a stock reader is rendering **our** EPUB 3 books richly (the audio/animation the in-app reader already handles). This is a **separate sub-project** (likely its own repo) needing its own decomposition — it is explicitly **not** a single spec+plan slice.

## Why (and what this reverses)

- **Reverses ADR-040's "only-our-reader" moat lean.** The moat is re-cast: not *"only our reader can open the content"* but *"our reader (and our downloadable viewer) render it best — full audio + animation — while the text + static content travels everywhere via broad EPUB export."* Reach and convenience are judged more valuable than lock-in for this audience (SME authors want their work to go anywhere).
- **EPUB 2 profile chosen over "just rely on the ncx fallback."** The existing EPUB 3 + `toc.ncx` already opens in many old readers, but degrades unpredictably and isn't valid EPUB 2. A strict `epub2` profile gives an author a *guaranteed*, validation-clean EPUB 2 for the reader that rejects an EPUB 3 package outright — a real, if narrowing, audience the author (not us) may need to reach.
- **Standalone generic viewer chosen over "reuse the in-app reader only."** A downloadable viewer that opens *any* EPUB 3 (not just Mentible books) is a reach/distribution play — but only tractable because it **rides an existing engine** (ADR-004 D7), not a from-scratch build.

## Non-goals / out of scope for this ADR

- **No code.** Each initiative gets its own spec + plan (Initiative A: a compiler profile slice; Initiative B: a decomposed sub-project, likely a new repo).
- **No video / A-V** (still deferred — ffmpeg, ADR-040).
- **MOBI/AZW** — deprecated by Kindle; not an export tier (KDP profile covers Kindle via EPUB).
- **Not a from-scratch EPUB engine** for the viewer (ADR-004 D7 — ride an existing one).
- This ADR does **not** deprecate the in-app reader or ADR-040's rungs — library-carried audio + our own rich rendering continue; portability is *additive*.

## Open questions (resolve per-initiative, not here)

1. **EPUB 2 audio fallback:** drop `<audio>` entirely, or emit the `transcript` as a prose "Narration" section so the content survives (recommended — cheap, keeps the words)? Decide in Initiative A's spec.
2. **Viewer engine choice (Initiative B):** Readium (mobile SDKs, strong EPUB 3) vs epub.js (web) vs foliate — build-vs-buy per ADR-004 D7; and web-viewer vs installable app vs both. A decomposition decision, not this ADR.
3. **Where the viewer's "renders our books richly" edge lives:** a plugin/overlay on the engine vs reusing `mobile/src/reader/` rendering — Initiative B decides.
4. **Does the strict EPUB 2 profile pair with the KDP profile** (a book destined for both), and how the export UI presents three EPUB-family choices (rich EPUB 3 / KDP / EPUB 2) without confusing the author.

## Staged path

- **Now:** this ADR (records the pivot).
- **Next (Initiative A):** the `--profile epub2` compiler slice — spec + plan + SDD, like the KDP profile. First tangible deliverable.
- **Later (Initiative B):** decompose the standalone viewer as its own sub-project (engine choice, repo, scope) — its own ADR/spec; sized as a multi-slice effort, not rushed.
