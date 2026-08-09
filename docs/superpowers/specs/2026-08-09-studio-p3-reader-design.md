# Studio P3 — Reader (navy/paper surface + Playfair) — Design

**Status:** Approved (brainstorming, 2026-08-09). Fourth slice of the Studio re-skin
([[project_studio_reskin]]); P0/P1/P2 shipped. Companion:
`docs/superpowers/specs/2026-08-08-studio-reskin-design.md` (P3 = "Reader chrome + navy reading surface").

## Problem

The reading surface renders **off-identity and non-theme-reactive**. Two parallel stylesheets both
bake the **static, retired `study` palette** (indigo `#14152a`) via `import { colors }`:

- `mobile/src/reader/readerStyles.ts` (`READER_CSS`, scoped under `.mentible-reader`) → the **web**
  readers (`NativeTopicReader.web.tsx` / `NativeQuizReader.web.tsx` / `NativeChapterReader.web.tsx`).
- `mobile/src/components/contentHtml.ts` (`READER_STYLES`, unscoped) → the **native** WebView doc
  (`buildTopicHtml`/`buildChapterHtml`/`buildChapterQuizHtml`).

The reader content body is already shared (`@/reader/topicHtml`), but the CSS is a **twin** that has
drifted and is stuck on the old palette. Several rules also **assume a dark background** and would
break on the studio-light paper theme: the equation-PNG trick (`filter: invert(1); mix-blend-mode:
screen` turns black-on-white math white-on-black — on paper it erases the equation), `color-scheme:
dark`, and hardcoded literals (`code { color:#e2e8f0 }`, `.error-banner`).

## Goal

The reading surface **follows the app theme** (studio-dark navy ↔ studio-light paper) with **Playfair
headings + Source Serif 4 body**, across BOTH stylesheets, with the delicate authored-content
typography (equations, diagrams, tables, quizzes) intact in both themes.

## Locked decisions (brainstorming 2026-08-09)

1. **Follow the app theme** (not fixed-navy): the reading surface is a function of the active palette
   — navy in studio-dark, paper in studio-light.
2. **Playfair headings + serif body**: h1–h3 → Playfair Display; body stays Source Serif 4; retire
   the 700 heading weights (Playfair medium).
3. **Embed Playfair in the native WebView** as a data-URI `@font-face` (like the compiler embeds
   Source Serif) so native headings are true Playfair, not a serif fallback.

## Architecture

### Shared drift-killer + correctness fix — `readerVars(palette)` (new, in `readerStyles.ts`)

Export `readerVars(palette: Palette): string` returning the CSS custom-property lines (no wrapping
selector, so each caller inlines them into its own root rule):

- `--bg/--surface/--surfaceHigh/--border/--text/--text2/--muted/--primary/--success/--error/--warning`
  from the **passed** palette (not the static `colors` import).
- `--eq-filter`: `invert(1)` when the palette background is dark, else `none` — **the equation-invert
  is gated so it never erases math on paper.**
- `--reader-scheme`: `dark` or `light` for the `color-scheme` property.
- Dark/light is decided by a small `isDarkBackground(hexOrPalette): boolean` helper (relative
  luminance of `palette.background` < 0.5) — no new field on the `Palette` type, no touching the
  other palette defs.

Both stylesheets import `readerVars` + `isDarkBackground`, so colors/scheme/eq-filter never diverge
again — the twin's dangerous part (color + dark-assumption) is unified even though the rule bodies
stay per-file (scoped web vs unscoped native).

### Web — `readerStyles.ts` `READER_CSS` → `readerCss(palette)`

Convert the const to `readerCss(palette: Palette): string`:
- Inline `readerVars(palette)` into the `.mentible-reader { … }` root rule; set `color-scheme:
  var(--reader-scheme)` and the equation rule's filter to `var(--eq-filter)` (drop the hardcoded
  `invert(1); mix-blend-mode: screen` — fold the blend into the gated var or emit both only when dark).
- Add `--display: 'PlayfairDisplay_500Medium', 'Playfair Display', Georgia, 'Times New Roman', serif;`
  (web resolves the expo `PlayfairDisplay_500Medium` @font-face; the `'Playfair Display'` name is the
  native embedded fallback). h1–h3 use `font-family: var(--display)`; **drop `font-weight: 700`**
  (Playfair medium carries the weight). Body keeps `var(--serif)`.
- Replace hardcoded color literals (`code { color:#e2e8f0 }`, any `#…`) with palette vars.
The 3 `.web.tsx` readers call `readerCss(useTheme())` instead of the const `READER_CSS`. `READER_ROOT_CLASS`
stays exported.

### Native font — `mobile/src/reader/playfairFont.ts` (new, mirrors `compiler/src/fonts.ts`)

Export `PLAYFAIR_FONTFACE: string` — one or two `@font-face{ font-family:'Playfair Display';
font-weight:400|500; font-display:swap; src:url(data:font/woff2;base64,…) }` blocks, base64-embedded
from the Playfair Display font files in `mobile/node_modules/@expo-google-fonts/playfair-display/`
(weights 400 + 500, latin). Prefer a woff2 latin subset (via `pyftsubset` if available) to keep the
embedded size down; fall back to the full `.ttf` as `data:font/ttf;base64` if no subsetter. Document
the source (Google Fonts, OFL) + the byte size in a header comment, like `compiler/src/fonts.ts`.

### Native — `contentHtml.ts`

- Its `READER_STYLES` block adopts `readerVars(palette)` + the same Playfair `--display` +
  gated-eq-filter + `color-scheme: var(--reader-scheme)` treatment (unscoped selectors — the WebView
  doc is isolated).
- Inject `PLAYFAIR_FONTFACE` into the doc `<head>` (alongside the existing styles).
- `buildTopicHtml`/`buildChapterHtml`/`buildChapterQuizHtml` gain a `palette: Palette` param;
  thread it from each `Native*Reader.tsx` (native) via `useTheme()`. Keep the shared content body
  (`renderTopicToHtml` etc.) unchanged — only the doc wrapper/style is parametrized.

### Chrome

`book/read/[id].tsx` already uses `useThemedStyles` + inherits P2's StudioHeader. A light pass on any
raw in-body control (download/checkout → `<Button>`, section headings → Playfair) **only if it
visibly lags** the P2 screens; otherwise leave it.

## Reuse map

- `readerVars`/`isDarkBackground` (new) → both stylesheets (the one source of color+scheme+eq-filter).
- `@/reader/topicHtml` shared content body → unchanged (do not fork — [[project_reader_one_renderer]]).
- `compiler/src/fonts.ts` embedding pattern → `playfairFont.ts`.
- P2 `Button`/`Label` primitives → any chrome touch-up.

## Testing

- **`readerVars`/`isDarkBackground` (unit):** `isDarkBackground(studioDarkColors)` true,
  `isDarkBackground(studioLightColors)` false; `readerVars(studioDarkColors)` contains `--eq-filter:
  invert(1)` + `--reader-scheme: dark` + `--bg: #0A0E1A`; `readerVars(studioLightColors)` contains
  `--eq-filter: none` + `--reader-scheme: light`. **No color-literal asserts beyond the palette's own
  values** (assert the value equals `studioDarkColors.background`, not a bare hex).
- **`readerCss(palette)` (web):** the returned CSS contains the `--display` Playfair stack, no
  residual `font-weight: 700` on headings, and `var(--eq-filter)` on the equation rule (not a
  hardcoded `invert(1)`).
- **`contentHtml` build fns:** `buildTopicHtml(topic, studioLightColors)` embeds `PLAYFAIR_FONTFACE`,
  carries the light `--bg`, and the equation filter is `none`; passing `studioDarkColors` gives navy +
  `invert(1)`. The shared content body is unchanged (same topic HTML inside).
- **Sanitize/behaviour unchanged:** the native doc's sanitizer JS + the web `sanitize.ts` boundary are
  untouched (this is CSS + a font, not a content-pipeline change) — assert the build fns still call the
  same `renderTopicToHtml`.
- **Screenshot verify (jsdom can't see CSS render):** a real book with **an equation (inline math
  PNG), a Mermaid diagram, an ```svg figure, a table, and a quiz**, opened in **BOTH** studio-dark and
  studio-light — verify the equation is legible in both (the invert-gate), Playfair headings render,
  diagrams/tables/quiz intact. Web + a native device pass.

## Files

- Modify: `mobile/src/reader/readerStyles.ts` (add `readerVars`/`isDarkBackground`; `READER_CSS` →
  `readerCss(palette)`).
- Modify: `mobile/src/reader/NativeTopicReader.web.tsx`, `NativeQuizReader.web.tsx`,
  `NativeChapterReader.web.tsx` (call `readerCss(useTheme())`).
- Create: `mobile/src/reader/playfairFont.ts` (embedded `PLAYFAIR_FONTFACE`).
- Modify: `mobile/src/components/contentHtml.ts` (`readerVars` + Playfair embed + `palette` param on
  the 3 build fns).
- Modify: `mobile/src/reader/NativeTopicReader.tsx`, `NativeChapterReader.tsx`, `NativeQuizReader.tsx`
  (pass `useTheme()` palette into the build fns).
- Tests under `mobile/__tests__/reader/` (+ existing reader tests updated).

## Decomposition (SDD)

- **T1 — shared vars + web:** `readerVars`/`isDarkBackground` + `readerCss(palette)` + the 3 web
  readers. (Web goes fully theme-reactive + Playfair.)
- **T2 — embedded Playfair font:** `playfairFont.ts` (`PLAYFAIR_FONTFACE` data-URI, 400+500).
- **T3 — native:** `contentHtml.ts` adopts `readerVars` + Playfair embed + `palette` param; thread it
  through the 3 native readers.
- **T4 — verify + chrome:** the both-theme screenshot verification (real book) + any read-screen
  in-body chrome touch-up.

## Rollout

Mobile-only → **web redeploy**, no backend, no migration. The **equation-invert-on-light** gate is the
one real correctness risk — device-verify both themes on a math-bearing book before calling it done.

## Out of scope

- Compiler EPUB3/PDF export typography (P4 — separate stylesheet `compiler/src/css.ts`).
- Dyslexic-mode inside the reader (the injected CSS doesn't pass through `applyGlobalFont`; the reader
  was already not dyslexic-reactive — unchanged here, noted for a later slice).
- posts/shelves screens.

## Global constraints

Follow the active palette (never the static `colors` import) — the reading surface must react to the
Settings theme. Playfair headings ≥16px, retire 700; body serif kept. **Gate the equation `invert` on
dark-vs-light — never erase math on paper.** Do NOT fork the shared content renderer
([[project_reader_one_renderer]]) — only the doc wrapper/style is parametrized. Model-authored SVG
still passes the existing sanitize boundary (unchanged). `npx tsc --noEmit` clean + full `npx jest`
green. No color-literal test asserts beyond a palette's own token values.
