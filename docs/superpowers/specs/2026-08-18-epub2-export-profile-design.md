# EPUB 2 Export Profile (ADR-041 Initiative A) — Design Spec

**Status:** Proposed · **Date:** 2026-08-18 · **Area:** `compiler/src`, `backend/src/export`, `mobile/` · **Implements:** ADR-041 Initiative A · **Reuses:** the KDP profile machinery (`docs/specs/kdp-clean-export-profile.md`)

## Why

ADR-041 (portability-first) decided to offer Mentible books in multiple EPUB tiers. The compiler emits **EPUB 3** (`version="3.0"`, `nav.xhtml`, `dcterms:modified`, HTML5 `<!DOCTYPE html>`) with a `toc.ncx` backward-compat gesture. Some content is **EPUB 3-only** — `<audio>` (rung 2 / P4), animated SVG diagrams, inline MathML — so an EPUB 2-only reader that *rejects* an EPUB 3 package gets nothing. This adds a third compiler profile — **`epub2`** — that produces a **strict, validation-clean EPUB 2.0.1** for those readers: a deliberate lossy downgrade of the rich content. The rich **EPUB 3 stays the default**; KDP stays as-is.

## Decisions

- **D1 — A new `--profile epub2` on `--format epub`.** Extend the compiler profile enum from `"default" | "kdp"` to `"default" | "kdp" | "epub2"` (`compiler/src/epub.ts`). Like KDP, threaded end-to-end (cli → backend `/export` → mobile). It produces an EPUB (just EPUB 2-flavored), so `--profile epub2` is only valid with `--format epub`/`pack` (same guard family as KDP).
- **D2 — Reuse KDP's raster steps (they also flatten animations).** For `epub2`, math → raster PNG and Mermaid diagrams → raster PNG, using the **exact same** `rasterizeMath`/`replaceMathWithImages` + `PrerenderedRasterDiagramRenderer`/`rasterizeDiagramPngs` KDP uses. A rastered diagram is a **static PNG** — so this *is* the "flatten animated SVG" requirement (no `<animate>`/SMIL survives). Generalize the relevant `profile === "kdp"` branches to `profile !== "default"` where the behavior is shared (raster math + raster diagrams — **and, per the epubcheck finding below, the JPEG raster cover**: an inline cover SVG carries SVG-1.1-invalid attributes that fail EPUB2 validation, so `epub2` uses the JPEG cover like KDP); keep the remaining KDP-only branches (font-drop, `dc:date` ISO, KDP stylesheet, draft guard) gated on `=== "kdp"`. *(Amended 2026-08-18: the JPEG cover moved from KDP-only to `!== "default"` after the epubcheck-as-EPUB2 gate showed the inline cover SVG is not EPUB2-valid.)*
- **D3 — EPUB 2 packaging deltas** (the net-new work, all gated on `=== "epub2"`):
  - **OPF `version="2.0"`** (not 3.0).
  - **NCX is the primary nav** — the `toc.ncx` is already emitted for every profile; for epub2, do NOT write `nav.xhtml`, do NOT add the `<item … properties="nav"/>` manifest entry, and ensure the spine references `toc="ncx"` (EPUB 2 requires the `<spine toc="ncx">` attribute + an NCX manifest item — verify it's present).
  - **EPUB 2 metadata syntax** — drop the EPUB 3-only `<meta property="dcterms:modified">` and the `<meta property="schema:accessMode…">` a11y block (EPUB 3 property syntax); EPUB 2 uses `<meta name="…" content="…"/>` and the `<dc:*>` elements (which are already EPUB2-valid). The cover uses the EPUB2 `<meta name="cover" content="cover-image"/>` convention (already emitted).
  - **XHTML content docs** — EPUB 2 content is XHTML 1.1: replace the HTML5 `<!DOCTYPE html>` with the XHTML 1.1 DOCTYPE and drop `xmlns:epub="…/ops"` (and any `epub:type` attributes) for the epub2 profile (thread the profile into `xhtmlDocument`/the chapter builder).
  - **EPUB 2 core media types only** — images (jpeg/png/gif/svg) are fine; **no `audio/mpeg`** (see D4).
- **D4 — Audio: strip + keep the words.** `<audio>` is EPUB 3-only. Two layers:
  - **Compiler (defensive):** for `epub2`, strip any `<audio …>…</audio>` element from the chapter XHTML before packaging (regex, sibling to `packMedia`), and do NOT run `packAudio` / emit an `OEBPS/audio/` resource. Guarantees a valid EPUB 2 even if a payload carries `<audio>`.
  - **Mobile (keep the words — ADR-041 OQ1):** `buildCompilePayload(book, format)` (which already gates audio to EPUB-family) emits, for the **`epub2`/max-compat target**, the `TopicAudio.transcript` as a prose "Narration (transcript)" section *instead of* the `<audio>` element — so the narration's words survive in EPUB 2 even though the clip can't. (Mobile has the transcript on the `TopicAudio` ref; the compiler doesn't.)
- **D5 — Delivery + guard.** A distinct **"EPUB 2 (max compatibility)"** export action on the same surfaces the rich EPUB / KDP exports live on (`CheckoutButton`); mobile threads `profile: "epub2"`. Backend `/export` + `/export/jobs` accept `profile=epub2`, exempt it from the kdp+non-epub 422 the same way (epub2 requires an epub-family format), and gate it through the existing `_export_gate_feature` (reuse `export_epub`, like pack — no new billing feature). Help DoD: an `epub2-export` FEATURES key + topic + tree leaf.
- **D6 — Validation gate.** epubcheck auto-detects the OPF version, so running the existing epubcheck harness on the **`epub2`-profile** output validates it *as EPUB 2* — a fixture book compiled with `--profile epub2` must pass `0 fatals / 0 errors` (java-gated like `kdpEpubcheck.test.ts`/`audioEpubcheck.test.ts`). This is the real gate that catches an EPUB2-invalid construct (a stray HTML5 element, an EPUB3-only meta).

## Architecture (touch-points)

- **Compiler `compiler/src/epub.ts`** (the bulk): profile enum += `"epub2"`; generalize raster-math + raster-diagram branches to `!== "default"`; `buildOpf` emits `version="2.0"` + drops nav item + EPUB2 metadata for epub2; skip `nav.xhtml` write for epub2; strip `<audio>` for epub2; ensure spine `toc="ncx"`. `compiler/src/xhtml.ts`: XHTML 1.1 doctype + no `xmlns:epub` for epub2 (thread the profile in). `compiler/src/cli.ts`: `--profile epub2` parse.
- **Backend `backend/src/export/`**: `compiler.py` passes `--profile epub2`; `router.py` accepts `epub2`, guard-exempts it (epub-family), gates via `_export_gate_feature` → `export_epub`.
- **Mobile**: `CheckoutButton` "EPUB 2 (max compatibility)" action → `exportBook({format:"epub", profile:"epub2"})` (or the export path's profile field); `client.ts` threads `profile`; `buildCompilePayload(book, "epub2")` emits the transcript-prose fallback for audio; Help `epub2-export` feature+topic+tree.
- **NO change** to the default or KDP output — every epub2 behavior gated on `=== "epub2"` (or the shared raster steps on `!== "default"`, which leave `default` untouched and `kdp` unchanged).

## Non-goals

- No MOBI/AZW.
- No audio/animation/interactivity in the EPUB 2 output — that's the whole point of the tier (lossy downgrade). The rich experience stays in EPUB 3 / our reader.
- No standalone viewer (ADR-041 Initiative B — separate).
- No change to the EPUB 3 default or KDP profiles.

## Testing

- **Compiler:** an `--profile epub2` compile of a fixture book asserts: OPF `version="2.0"`; **no** `OEBPS/nav.xhtml` and **no** `properties="nav"` manifest item; the NCX present + spine `toc="ncx"`; **no** `<audio>` and **no** `OEBPS/audio/`; math/diagrams are `<img>` (rastered), no `<animate>`/SMIL in any chapter; XHTML 1.1 doctype, no `xmlns:epub`; no `<meta property="dcterms:modified">`/`schema:accessMode`. **Default + KDP outputs byte-unchanged** (regression tests). A book with audio → the compiler strips `<audio>` (no OEBPS/audio, valid). 
- **Compiler epubcheck (D6, the real gate):** a fixture (with math + a diagram + an audio clip) compiled `--profile epub2` passes epubcheck as EPUB 2 (`0 fatals/0 errors`), java-gated.
- **Backend:** `profile=epub2` accepted on `/export` + `/export/jobs`; `profile=epub2`+non-epub format → 422; gated via `export_epub` (not a new feature); managed/BYOK unaffected (export is key-free/stateless).
- **Mobile:** the "EPUB 2 (max compatibility)" button requests `profile=epub2`; `buildCompilePayload("epub2")` emits the transcript prose (not `<audio>`) for a topic with audio, and no audio section for one without; button re-enables on error; Help coverage+tree green.
- **Real-render bar:** a local `--profile epub2` compile → unzip → assert `version="2.0"`, NCX-primary, no HTML5 audio, rastered math/diagrams (mirrors the KDP/pack/audio real-render discipline; mocked tests can't fully prove the packaged artifact).

## Rollout

Compiler + backend + mobile (no migration). Web deploy + backend ROOT refresh (the compiler layer in the api image gains the epub2 profile for server-side compiles) + APK. The rich EPUB 3 stays default; EPUB 2 is an opt-in "max compatibility" export.
