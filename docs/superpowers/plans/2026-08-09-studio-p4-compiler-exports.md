# Studio P4 — Compiler exports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Studio identity to the EPUB3/PDF exports — Playfair headings + gold accent on a warm-ivory print page, a navy/gold cover, Studio-tinted diagrams — while keeping the export print/KDP-legible.

**Architecture:** A `STUDIO` palette in `compiler/src/tokens.ts` becomes the single source; `css.ts` (text stylesheet), `cover.ts` (cover SVG), and the Mermaid theme draw from it. Playfair is embedded in the compiler (like the existing Source Serif embed) for true headings in the artifact. The compile pipeline (render/pdf/epub/xhtml) is untouched — palette + font + type only.

**Tech Stack:** Node/TypeScript compiler package; jest (`compiler/__tests__/*.test.ts`); puppeteer/Chromium PDF (not touched).

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-09-studio-p4-compiler-exports-design.md`.
- **The export stays a LIGHT, print/KDP-legible artifact:** dark-on-light body, warm-ivory ground (`#faf8f3`) + `#1a1a1a` ink + Source Serif body all KEPT. The navy identity lands ONLY on the cover. Every accent must remain distinguishable in **grayscale** (B&W print).
- **Playfair headings** with explicit `font-weight: 500` + `font-synthesis: none` — a single-weight face + a UA/`700` bold default synthesizes ugly faux-bold (the P3 lesson). Never leave a heading at `font-weight: 700`.
- **Gold accent split:** `gold #8A6A22` (dark) for accents on the LIGHT ground (AA on ivory/white); `goldBright #F0DCAC` (light) for accents on the NAVY cover.
- The compile pipeline (`renderCore`/`pdfRender`/`epub`/`xhtml`/`markdown`) is UNTOUCHED. **Update snapshot/golden tests to the new palette — never delete them.**
- `cd compiler && npm run build && npm test` green after each task. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `compiler/src/tokens.ts` — add `STUDIO`; retint `DIAGRAM_ROLES` + `MERMAID_THEME_VARIABLES` (T1)
- `compiler/src/playfairFont.ts` — NEW: `PLAYFAIR_FONTFACE` data-URI (T2)
- `compiler/src/css.ts` — Playfair headings + gold accent (T3)
- `compiler/src/cover.ts` — navy field + gold mark + Playfair title (T4)
- Tests: `compiler/__tests__/{mermaidTheme,cover,markdown}.test.ts` + new token/font tests; updated snapshots

---

### Task 1: Studio compiler tokens + diagram retint

**Files:**
- Modify: `compiler/src/tokens.ts`
- Test: `compiler/__tests__/mermaidTheme.test.ts` (extend) + a small token assertion

**Interfaces:**
- Produces: `STUDIO` (the export palette) and retinted `DIAGRAM_ROLES` / `MERMAID_THEME_VARIABLES`. `BRAND` MAY stay exported for any not-yet-migrated consumer, but `DIAGRAM_ROLES`/`MERMAID_THEME_VARIABLES` reference `STUDIO`.

- [ ] **Step 1: Write/extend the failing test** (`mermaidTheme.test.ts` + token check). Assert `STUDIO` exposes the documented keys and that `MERMAID_THEME_VARIABLES.primaryColor`/`DIAGRAM_ROLES.concept.fill` now reference Studio values (not `BRAND.indigo`). Example:
```ts
import { STUDIO, DIAGRAM_ROLES, MERMAID_THEME_VARIABLES } from "../src/tokens";
it("uses the Studio palette", () => {
  expect(STUDIO.navy).toBe("#0A0E1A");
  expect(STUDIO.gold).toBe("#8A6A22");
  expect(DIAGRAM_ROLES.concept.fill).toBe(STUDIO.navy);           // concept → navy
  expect(MERMAID_THEME_VARIABLES.primaryBorderColor).toBe(STUDIO.gold);
  // every role has a fill+color+stroke
  for (const r of Object.values(DIAGRAM_ROLES)) {
    expect(r.fill).toBeTruthy(); expect(r.color).toBeTruthy(); expect(r.stroke).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run — verify fail** — `cd compiler && npx jest __tests__/mermaidTheme.test.ts`.

- [ ] **Step 3: Implement.** Add to `tokens.ts`:
```ts
// Studio identity (P4) — the export palette. Light artifact: navy only on the
// cover; gold accents on the light page. AA-checked for grayscale legibility.
export const STUDIO = {
  navy: "#0A0E1A", navySurface: "#131E36", navyLuminous: "#1B2842", navyBorder: "#323846",
  navySoft: "#93A6C6",         // soft light-blue on navy (decorative lines on cover)
  gold: "#8A6A22",             // dark gold — accents on the LIGHT ground (AA on ivory/white)
  goldBright: "#F0DCAC",       // light gold — accents on the NAVY cover
  goldSoft: "#C9B37E",
  ivory: "#faf8f3", ink: "#1a1a1a", panel: "#f3efe6",   // warm light panel (cover lower)
  green: "#356E56", greenBright: "#8FCBAD",             // success / accent green (tuned, AA)
  amber: "#B5741A", amberText: "#5a3e12", amberFill: "#F1E2BE", // caution (distinct from gold)
} as const;
```
Retint `DIAGRAM_ROLES` (keep each fill↔color AA + grayscale-distinct):
```ts
export const DIAGRAM_ROLES: Record<string, RoleStyle> = {
  concept:  { fill: STUDIO.navy,       color: "#ffffff",      stroke: STUDIO.navyBorder },
  process:  { fill: STUDIO.panel,      color: STUDIO.navy,    stroke: STUDIO.gold },
  decision: { fill: STUDIO.goldSoft,   color: STUDIO.navy,    stroke: STUDIO.gold },
  success:  { fill: STUDIO.green,      color: "#ffffff",      stroke: "#274d3d" },
  warn:     { fill: STUDIO.amberFill,  color: STUDIO.amberText, stroke: STUDIO.amber },
};
```
Retint `MERMAID_THEME_VARIABLES`: `primaryColor: STUDIO.panel`, `primaryTextColor: STUDIO.navy`, `primaryBorderColor: STUDIO.gold`, `lineColor: STUDIO.gold`, `secondaryColor: "#e4efe8"` (soft green), `tertiaryColor: STUDIO.ivory`, `tertiaryTextColor: STUDIO.navy` (keep the fontFamily/fontSize). **AA-check each fill↔text pair; nudge a value if a pair fails, and note it in the report.** Keep `BRAND` defined (other files migrate in T3/T4).

- [ ] **Step 4: Run** — `cd compiler && npx jest __tests__/mermaidTheme.test.ts && npm run build`.

- [ ] **Step 5: Commit.**
```bash
git add compiler/src/tokens.ts compiler/__tests__/mermaidTheme.test.ts
git commit -m "feat(studio): P4 Studio compiler palette + retinted diagram roles (Studio P4 T1)"
```

---

### Task 2: Embed Playfair in the compiler

**Files:**
- Create: `compiler/src/playfairFont.ts`
- Test: `compiler/__tests__/playfairFont.test.ts` (new, thin)

**Interfaces:**
- Produces: `PLAYFAIR_FONTFACE: string` — `@font-face` declaring `'Playfair Display'` 400+500 with data-URI `src`.

- [ ] **Step 1: Locate + generate.** The font files are at
  `mobile/node_modules/@expo-google-fonts/playfair-display/{400Regular,500Medium}/PlayfairDisplay_*.ttf`.
  `pyftsubset` + fontTools-woff2 are available. Subset latin + convert to woff2 (do the work in the scratchpad, NOT the repo):
```
pyftsubset <in.ttf> --unicodes=U+0000-00FF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F --flavor=woff2 --output-file=<out.woff2>
base64 -w0 <out.woff2>
```
(These are the SAME bytes the mobile P3 embed used — you may copy the base64 from `mobile/src/reader/playfairFont.ts` if present, but the compiler carries its own copy — no cross-package import.)

- [ ] **Step 2: Write `playfairFont.ts`** mirroring `compiler/src/fonts.ts`'s `SOURCE_SERIF_FONTFACE` header + shape:
```ts
// Auto-generated: Playfair Display 400 + 500 (latin subset) embedded as a
// data-URI @font-face so the EPUB/PDF render true Playfair headings, fully
// self-contained (no network). Source: Google Fonts (OFL). Size: ~<N> KB.
export const PLAYFAIR_FONTFACE =
  "@font-face{font-family:'Playfair Display';font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,<...>)}" +
  "@font-face{font-family:'Playfair Display';font-style:normal;font-weight:500;font-display:swap;src:url(data:font/woff2;base64,<...>)}";
```

- [ ] **Step 3: Thin test** (`playfairFont.test.ts`):
```ts
import { PLAYFAIR_FONTFACE } from "../src/playfairFont";
it("declares Playfair Display 400+500 with embedded data URIs", () => {
  expect(PLAYFAIR_FONTFACE).toContain("font-family:'Playfair Display'");
  expect(PLAYFAIR_FONTFACE).toContain("font-weight:400");
  expect(PLAYFAIR_FONTFACE).toContain("font-weight:500");
  expect((PLAYFAIR_FONTFACE.match(/src:url\(data:font/g) || []).length).toBe(2);
});
```

- [ ] **Step 4: Run** — `cd compiler && npx jest __tests__/playfairFont.test.ts && npm run build`.

- [ ] **Step 5: Commit.**
```bash
git add compiler/src/playfairFont.ts compiler/__tests__/playfairFont.test.ts
git commit -m "feat(studio): P4 embed Playfair Display (400/500) for EPUB/PDF headings (Studio P4 T2)"
```

---

### Task 3: Text stylesheet — Playfair headings + gold accent

**Files:**
- Modify: `compiler/src/css.ts`
- Test: `compiler/__tests__/markdown.test.ts` (or a new `css.test.ts`) — assert stylesheet content

**Interfaces:**
- Consumes: `STUDIO` (T1), `PLAYFAIR_FONTFACE` (T2), `SOURCE_SERIF_FONTFACE`.

- [ ] **Step 1: READ `css.ts` fully.** Note every `BRAND.*` / indigo hex (`#1565c0` links, `BRAND.indigo` th, `BRAND.indigoDark`, `BRAND.greenBright`, `BRAND.lavender`, etc.) and the SANS-700 heading rules.

- [ ] **Step 2: Write/extend the test** (assert on the exported `STYLESHEET` string): contains `PLAYFAIR_FONTFACE` (or `'Playfair Display'`), a Playfair heading stack, `font-synthesis: none`, NO `font-weight: 700` on a heading rule, `STUDIO.gold` (`#8A6A22`) used for `th`/links, and STILL `background: #faf8f3` (warm ivory) + the SERIF body. No bare-indigo `#312a8c`/`#1565c0` left where replaced.
```ts
import { STYLESHEET } from "../src/css";
it("uses Playfair headings + gold accent on a kept ivory ground", () => {
  expect(STYLESHEET).toContain("Playfair Display");
  expect(STYLESHEET).toContain("font-synthesis: none");
  expect(STYLESHEET).not.toMatch(/h1[^}]*font-weight:\s*700/);
  expect(STYLESHEET).toContain("#8A6A22");     // gold accent
  expect(STYLESHEET).toContain("#faf8f3");     // warm ivory ground kept
  expect(STYLESHEET).not.toContain("#1565c0"); // old indigo link gone
});
```

- [ ] **Step 3: Implement.**
  - `import { PLAYFAIR_FONTFACE } from "./playfairFont";` and `import { STUDIO } from "./tokens";` (keep `SOURCE_SERIF_FONTFACE`). Prepend `${PLAYFAIR_FONTFACE}` alongside `${SOURCE_SERIF_FONTFACE}`.
  - Add `const DISPLAY = "'Playfair Display', Georgia, 'Times New Roman', serif";`. Change the `h1..h6 { font-family: ${SANS}; }` rule to `font-family: ${DISPLAY}; font-weight: 500; font-synthesis: none;`. Remove the per-level `font-weight: 700/600` on h1/h2/h3/h4 (keep their font-size/margins). h3's `color:#333` may stay or become `STUDIO.ink`.
  - Replace accents with STUDIO: links `#1565c0` → `STUDIO.gold`; `th { background: BRAND.indigo; ... border: BRAND.indigo }` → `STUDIO.gold` (white text stays — white-on-`#8A6A22` is AA); blockquote/`.objectives`/callout left-rails `#1565c0`/`BRAND.*` → `STUDIO.gold` or `STUDIO.navy` as fits; `.takeaways` dark panel `BRAND.indigoDark`/`greenBright` → `STUDIO.navy`/`STUDIO.goldBright`; caption/`.diagram figcaption` `BRAND.indigo` → `STUDIO.gold`; `tbody tr:nth-child(even) td` `#f6f5fc` → a warm neutral (`#f4f1ea`). Keep `background:#faf8f3`, `color:#1a1a1a`, `SERIF` body.
  - Grayscale sanity: `#8A6A22` on ivory and white-on-`#8A6A22` both read in B&W — keep.

- [ ] **Step 4: Run** — `cd compiler && npx jest __tests__/markdown.test.ts __tests__/css.test.ts 2>/dev/null; npm test && npm run build`. Update any snapshot that captured old colors.

- [ ] **Step 5: Commit.**
```bash
git add compiler/src/css.ts compiler/__tests__ 
git commit -m "feat(studio): P4 export stylesheet — Playfair headings + gold accent, ivory kept (Studio P4 T3)"
```

---

### Task 4: Cover — navy field + gold mark + Playfair title

**Files:**
- Modify: `compiler/src/cover.ts`
- Test: `compiler/__tests__/cover.test.ts` (update)

**Interfaces:**
- Consumes: `STUDIO` (T1). (The cover embeds the title via SVG `<text>`; the PDF has the embedded Playfair, the EPUB cover XHTML lists Playfair then serif fallbacks.)

- [ ] **Step 1: READ `cover.ts` fully.** Map every `BRAND.*` + hex: the `cvTop` gradient (indigoLuminous→indigo→indigoDark), the `cvMark` green gradient, `cvGlow` green shadow, the check→arrow mark fills (`BRAND.green`/`greenBright`), decorative lines (`BRAND.indigoSoft`), the lower panel (`BRAND.lavender`), byline (`BRAND.indigo`), subtitle rule (`BRAND.green`), edition (`BRAND.green`/draft red).

- [ ] **Step 2: Update the test** (`cover.test.ts`): assert the cover SVG now contains the Studio navy field + gold mark + a Playfair `font-family` on the title, and NOT the old indigo/green brand hexes where replaced. Match the existing test's assertion style (it likely greps the SVG string).

- [ ] **Step 3: Implement** (`import { STUDIO } from "./tokens";`):
  - `SERIF`/title: add a `DISPLAY = "'Playfair Display', 'Source Serif 4', Georgia, serif"` and use it for the main title `<text>` (keep SERIF for byline/subtitle if you prefer, or move to DISPLAY).
  - `cvTop` gradient stops → `STUDIO.navyLuminous` → `STUDIO.navy` → `#05070E` (deep). `cvMark` gradient → `STUDIO.goldBright` → `STUDIO.goldSoft`. `cvGlow` flood-color → `STUDIO.goldBright`. `cvBand`/decorative → navy-family (`STUDIO.navySoft` at low opacity).
  - The check→arrow mark fills (`BRAND.green`/`greenBright`) → gold (`STUDIO.goldBright`); the ring stroke stays white.
  - Lower panel `BRAND.lavender` → `STUDIO.panel` (warm light). Byline `BRAND.indigo` → `STUDIO.navy` (or `STUDIO.gold`); subtitle rule `BRAND.green` → `STUDIO.gold`; edition `BRAND.green` → `STUDIO.gold` (keep draft red `#b91c1c`); decorative lines `BRAND.indigoSoft` → `STUDIO.navySoft`.
  - Keep geometry (VW/VH/SPLIT_Y/margins), the logo data-URI, and the word-wrap logic unchanged.

- [ ] **Step 4: Run** — `cd compiler && npx jest __tests__/cover.test.ts && npm test && npm run build`. Update the cover snapshot if present.

- [ ] **Step 5: Commit.**
```bash
git add compiler/src/cover.ts compiler/__tests__/cover.test.ts
git commit -m "feat(studio): P4 cover — navy field + gold mark + Playfair title (Studio P4 T4)"
```

---

### Task 5: Verify — full suite + real EPUB/PDF compile + grayscale check

**Files:** none (verification; fix any residual only if found)

- [ ] **Step 1: Full compiler suite + build** — `cd compiler && npm run build && npm test`. All green. Grep `compiler/src` for residual `BRAND.indigo`/`BRAND.green`/`#1565c0`/`#312a8c` in css.ts + cover.ts (tokens.ts may still export BRAND for unmigrated spots — that's fine; flag any left in the two restyled files).
- [ ] **Step 2: Compile a real book to BOTH formats.** Use the CLI (`compiler/src/cli.ts`) or an existing fixture to compile a topic book that has **a table, a Mermaid diagram, a callout (.takeaways/.objectives), and a quiz** to **EPUB and PDF** into the scratchpad. If a ready fixture/sample isn't obvious, note the exact command attempted + any blocker in the report rather than guessing.
- [ ] **Step 3: Inspect** the outputs: Playfair headings render, gold accents present, navy/gold cover, diagrams legible, warm-ivory page. **Grayscale check** — convert a PDF page (or view mono) and confirm every accent (gold th, gold links, diagram nodes) stays distinguishable. Note findings + any screenshot paths in the report.
- [ ] **Step 4: Report** — write `PASS`/issues to the report; if a real defect is found (e.g. a low-contrast diagram pair, a residual indigo), fix it in the owning file + re-run that file's test + commit `fix(studio): P4 verify fixups`.

---

## Final verification (after all tasks)

- [ ] `cd compiler && npm run build && npm test` — green.
- [ ] `css.ts` + `cover.ts` carry no residual replaced indigo/green literals; headings are Playfair `500` + `font-synthesis: none`; warm-ivory ground + Source Serif body intact.
- [ ] A real EPUB + PDF compiled and visually verified (Playfair, gold accents, navy/gold cover, legible diagrams) + a grayscale/print legibility pass.
- [ ] PR body: compiler-only re-skin; ships to prod **with a backend refresh** (the compiler builds inside the backend image) — NOT mobile-only; no migration.

## Self-Review

- **Spec coverage:** Studio tokens + diagram retint (T1) · embed Playfair (T2) · stylesheet Playfair+gold (T3) · cover navy/gold/Playfair (T4) · verify + grayscale (T5). Reader/mobile out of scope; KDP profile out of scope.
- **Type consistency:** `STUDIO`/`DIAGRAM_ROLES`/`MERMAID_THEME_VARIABLES` (T1) consumed by css.ts (T3) + cover.ts (T4); `PLAYFAIR_FONTFACE` (T2) consumed by css.ts (T3). `RoleStyle` shape unchanged.
- **Constraints:** light print artifact preserved (ivory + serif body + dark-on-light); navy only on the cover; Playfair explicit `500` + `font-synthesis: none` (no faux-bold); grayscale legibility called out in T1 (diagram AA) + T3/T5 (accent mono check); pipeline untouched; snapshots updated not deleted.
