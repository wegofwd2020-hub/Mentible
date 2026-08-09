# Studio P4 — Compiler exports (EPUB3/PDF typography + cover + diagrams) — Design

**Status:** Approved (brainstorming, 2026-08-09). Fifth and LAST slice of the Studio re-skin
([[project_studio_reskin]]); P0/P1/P2/P3 shipped. Companion:
`docs/superpowers/specs/2026-08-08-studio-reskin-design.md` ("P4 = EPUB3/PDF compile typography;
touches the shipped artifact — most careful, last").

## Problem

The Node `compiler/` package (EPUB3 + PDF via puppeteer/Chromium) still renders exports in the old
indigo/green "growing mind" brand: `compiler/src/css.ts` (warm-ivory page, Nimbus-Sans 700 headings,
indigo table headers/links/rails), `compiler/src/cover.ts` (deep-indigo cover field + green
validated-mark), and `compiler/src/tokens.ts` (`BRAND` indigo/green + `DIAGRAM_ROLES` +
`MERMAID_THEME_VARIABLES` — the Mermaid node palette). None carries the Studio identity that now runs
across the app (P0–P2) and the reader (P3).

## Goal

The exported book carries the Studio identity — **Playfair headings + a gold accent on a warm-ivory
print page**, a **navy/gold cover**, and **Studio-tinted diagrams** — while staying **print/KDP-legible**
(dark-on-light body; every accent survives grayscale).

## Locked decisions (brainstorming 2026-08-09)

1. **Keep the warm-ivory print ground** (`#faf8f3`) — a classic book-paper ground, better in print/e-ink
   than the app's cooler paper. The identity comes from the type + accent, not the near-white shade.
2. **Full scope:** text stylesheet + cover + diagram-node colors (not typography-only).
3. **Cover validated-mark → gold** (the one Studio accent), not the old green.
4. **The export is a LIGHT artifact** — the navy identity lands only on the **cover** (a cover may be
   bold); reading pages stay light (dark-on-light). No dark reading pages (ink/e-ink cost).

## Architecture

The export identity flows from `compiler/src/tokens.ts`, consumed by `css.ts` (stylesheet),
`cover.ts` (cover SVG), and `mermaid.ts` (diagram theme). Four surfaces:

### 1. Studio compiler tokens — `tokens.ts`

Add a `STUDIO` palette (single source) and repoint the consumers off the indigo/green `BRAND`:
- `navy: #0A0E1A`, `navySurface: #131E36`, `navyBorder: #323846` — the cover field + dark accents.
- `gold: #8A6A22` — **dark gold, for accents on the LIGHT/ivory ground** (AA on ivory: links, table
  headers with white text, callout rails, captions).
- `goldBright: #F0DCAC` — **light gold, for accents on the NAVY cover** (mark, wordmark).
- `ivory: #faf8f3`, `ink: #1a1a1a` — kept.
- Tuned support hues for callouts/diagrams (green/amber) chosen for grayscale legibility.

Retint `DIAGRAM_ROLES` + `MERMAID_THEME_VARIABLES` to the Studio family: `concept` → navy fill /
white text; `process` → pale-gold or warm-neutral fill / navy text / gold stroke; `decision` → a
distinct Studio-family fill; `success`/`warn` → tuned green/amber. **Every node keeps text↔fill
contrast (WCAG AA) and stays distinguishable in grayscale** — the implementer AA-checks each and
notes the values.

### 2. Embed Playfair — `fonts.ts`

Add `PLAYFAIR_FONTFACE` (Playfair Display 400 + 500, latin, woff2 data-URI, ~38KB) mirroring the
existing `SOURCE_SERIF_FONTFACE` shape, so EPUB/PDF headings are true Playfair, self-contained (no
network). Family name `'Playfair Display'`. (Same font bytes as the mobile P3 embed; the compiler is a
separate package, so it carries its own copy — no cross-package import.)

### 3. Text stylesheet — `css.ts`

- Prepend `PLAYFAIR_FONTFACE`. A `--display`-style Playfair heading stack (`'Playfair Display',
  Georgia, 'Times New Roman', serif`) on h1–h6; **retire the `font-weight: 700/600`** → explicit
  `font-weight: 500` + `font-synthesis: none` (the P3 faux-bold lesson — a single-weight face + a UA
  bold default synthesizes ugly bold). Keep the SANS stack only where it's genuinely a sans role
  (e.g. captions/quiz-question labels) or move those to Playfair/gold as fits.
- Replace the indigo brand (`BRAND.indigo`, `#1565c0` links, `BRAND.indigoDark`, etc.) with the
  Studio gold/navy tokens: table `th` background → `gold` with white text; links → `gold`; callout
  left-rails and the `.takeaways`/`.objectives`/… accent borders → gold/navy family; captions →
  gold. **Warm-ivory ground + `#1a1a1a` ink + Source Serif body unchanged.**
- Grayscale check: gold `#8A6A22` on ivory and white-on-gold both read in mono print.

### 4. Cover — `cover.ts`

- Upper field: deep indigo → **Studio navy** (`#0A0E1A`/`navySurface`).
- Validated check→arrow mark: green → **gold** (`goldBright #F0DCAC` on the navy field).
- Title: serif → **Playfair** (the embedded face is available in the PDF; the EPUB cover XHTML lists
  Playfair then serif fallbacks). Wordmark/byline in gold/light on navy.
- Light lower panel kept (title reads dark on light). Layout geometry (VW/VH/splits) unchanged.

## Reuse map

- `compiler/src/fonts.ts` `SOURCE_SERIF_FONTFACE` shape → `PLAYFAIR_FONTFACE`.
- `compiler/src/tokens.ts` `STUDIO` → the single source for `css.ts`/`cover.ts`/`mermaid.ts`.
- The mobile P3 pattern (explicit heading weight + `font-synthesis: none`) → the export stylesheet.
- The compile pipeline (`renderCore`/`pdfRender`/`epub`/`xhtml`) is UNTOUCHED — palette+font+type only.

## Testing

- **tokens:** `STUDIO` exports the documented values; `DIAGRAM_ROLES`/`MERMAID_THEME_VARIABLES` now
  reference Studio tokens (no residual `BRAND.indigo`/green where retinted). A small assertion that
  each retinted role's fill+text pair is defined.
- **fonts:** `PLAYFAIR_FONTFACE` declares `'Playfair Display'` 400+500 with 2 woff2 data-URIs (mirror
  the P3 font test).
- **css.ts:** `STYLESHEET` contains the Playfair heading stack, `font-synthesis: none`, no residual
  `font-weight: 700` on headings, the gold accent on `th`/links, and still the warm-ivory `background`
  + Source Serif body. No indigo hex literals left where replaced.
- **cover.ts:** the cover SVG contains navy field + gold mark + Playfair title; existing cover
  snapshot/golden tests **updated** to the new palette (not deleted).
- **Compiler suite green** (`cd compiler && npm test`) — update any snapshot that captured the old
  colors; the diagram/render/markdown tests must stay green.
- **Manual artifact verify:** compile a real book (a topic book with a table, a Mermaid diagram, a
  callout, and a quiz) to **both EPUB and PDF**; open each — Playfair headings, gold accents, navy/gold
  cover, diagrams legible; and a **grayscale/print check** (accents distinguishable in B&W).

## Files

- Modify: `compiler/src/tokens.ts` (`STUDIO` + retint `DIAGRAM_ROLES`/`MERMAID_THEME_VARIABLES`).
- Create: `compiler/src/playfairFont.ts` (or add `PLAYFAIR_FONTFACE` to `fonts.ts`).
- Modify: `compiler/src/css.ts` (Playfair headings + gold accent).
- Modify: `compiler/src/cover.ts` (navy field + gold mark + Playfair title).
- Modify: `compiler/src/mermaid.ts` only if it reads the retinted tokens indirectly (verify).
- Tests under `compiler/` (token/font/css/cover) + any updated snapshots.

## Decomposition (5 SDD tasks)

- **T1 — Studio tokens** (`tokens.ts`): `STUDIO` palette + retint `DIAGRAM_ROLES`/`MERMAID_THEME_VARIABLES`.
- **T2 — Embed Playfair** (`fonts.ts`/`playfairFont.ts`): `PLAYFAIR_FONTFACE` (400/500 latin woff2).
- **T3 — Text stylesheet** (`css.ts`): Playfair headings (explicit 500 + `font-synthesis: none`) + gold
  accent; warm-ivory + serif body kept.
- **T4 — Cover** (`cover.ts`): navy field + gold mark + Playfair title.
- **T5 — Verify:** compiler suite green + a real EPUB+PDF compile + grayscale check (report).

## Rollout

The compiler ships **inside the backend Docker image** (`backend/Dockerfile` stage 1 builds
`compiler/dist`), so this is **NOT mobile-only** — it needs a **prod backend refresh** to take effect
(the `--no-cache build api` rebuilds the compiler stage). No migration, no mobile change. The demo/app
web export uses the same compiled artifact once the backend is refreshed.

## Out of scope

- Dark/night reading pages in the export (deliberately not — print/e-ink artifact stays light).
- The KDP-clean export *profile* (#337, a separate open spec) — P4 restyles the single default
  stylesheet; it must not *break* KDP legibility but doesn't add the profile.
- The reader (P3, shipped), mobile chrome (P2, shipped).

## Global constraints

The export stays a LIGHT, print/KDP-legible artifact (dark-on-light body; every accent readable in
grayscale). Navy identity only on the cover. Playfair headings with explicit `font-weight: 500` +
`font-synthesis: none` (no faux-bold — the P3 lesson). Warm-ivory ground + Source Serif body kept. The
compile pipeline (render/pdf/epub/xhtml) is untouched — palette + font + type only. Update snapshots,
don't delete them. `cd compiler && npm run build && npm test` green.
