# Studio P3 — Reader (navy/paper surface + Playfair) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reading surface follow the app theme (studio-dark navy ↔ studio-light paper) with Playfair headings + Source Serif body, across BOTH reader stylesheets (web `readerStyles.ts` + native `contentHtml.ts`), without breaking authored-content typography (esp. the equation-PNG invert on the light theme).

**Architecture:** A shared `readerVars(palette)`/`isDarkBackground` helper is the single source of the CSS color vars + `color-scheme` + a gated `--eq-filter`; the web CSS becomes `readerCss(palette)`; the native WebView doc adopts the same vars + an embedded Playfair `@font-face`; the active palette is threaded from `useTheme()` into both paths. Content body (`@/reader/topicHtml`) is untouched — only the doc wrapper/style is parametrized.

**Tech Stack:** React Native + Expo + `react-native-webview`; TypeScript; Jest/RNTL.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-09-studio-p3-reader-design.md`.
- **Follow the active palette — never the static `import { colors }`.** The reading surface must react to the Settings theme.
- **Gate the equation `invert` on dark-vs-light** (`--eq-filter: invert(1)` dark / `none` light) — never erase math on the paper theme. Same for `color-scheme` (`dark`/`light`).
- Playfair headings (`--display` stack) at ≥16px, **retire `font-weight: 700`** on headings; body keeps Source Serif 4 (`--serif`). Small (≤14px) UI text unaffected.
- Do NOT fork the shared content renderer (`@/reader/topicHtml`) — only the doc wrapper/style is parametrized (`[[project_reader_one_renderer]]`). The web `sanitize.ts` boundary + the native doc's sanitizer JS are untouched.
- No color-literal test asserts **beyond a palette's own token values** (assert `=== studioDarkColors.background`, never a bare hex).
- `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/src/reader/readerStyles.ts` — add `isDarkBackground` + `readerVars(palette)`; `READER_CSS` → `readerCss(palette)` (T1)
- `mobile/src/reader/NativeTopicReader.web.tsx`, `NativeQuizReader.web.tsx`, `NativeChapterReader.web.tsx` — call `readerCss(useTheme())` (T1)
- `mobile/src/reader/playfairFont.ts` — NEW: embedded `PLAYFAIR_FONTFACE` data-URI (T2)
- `mobile/src/components/contentHtml.ts` — `readerVars` + Playfair embed + `palette` param on the 3 build fns (T3)
- `mobile/src/components/LessonRenderer.tsx` — thread `useTheme()` palette into `buildTopicHtml/buildChapterHtml/buildChapterQuizHtml` (T3)
- Tests: `mobile/__tests__/reader/readerStyles.test.ts` (T1), `mobile/__tests__/reader/contentHtml.test.ts` (T3), existing reader tests updated

---

### Task 1: Shared reader vars + web `readerCss(palette)`

**Files:**
- Modify: `mobile/src/reader/readerStyles.ts`
- Modify: `mobile/src/reader/NativeTopicReader.web.tsx`, `mobile/src/reader/NativeQuizReader.web.tsx`, `mobile/src/reader/NativeChapterReader.web.tsx`
- Test: `mobile/__tests__/reader/readerStyles.test.ts` (new)

**Interfaces:**
- Produces: `isDarkBackground(palette: Palette): boolean`; `readerVars(palette: Palette): string` (CSS custom-property lines, no wrapping selector); `readerCss(palette: Palette): string` (the full scoped stylesheet). `READER_ROOT_CLASS` stays exported. `READER_CSS` const is removed (callers switch to `readerCss`).

- [ ] **Step 1: Write the failing test** (`readerStyles.test.ts`):
```ts
import { readerVars, readerCss, isDarkBackground } from "@/reader/readerStyles";
import { studioDarkColors, studioLightColors } from "@/constants/theme";

describe("reader theme vars", () => {
  it("detects dark vs light backgrounds", () => {
    expect(isDarkBackground(studioDarkColors)).toBe(true);
    expect(isDarkBackground(studioLightColors)).toBe(false);
  });
  it("gates the equation invert + color-scheme on the theme", () => {
    const dark = readerVars(studioDarkColors);
    expect(dark).toContain(`--bg: ${studioDarkColors.background}`);
    expect(dark).toContain("--eq-filter: invert(1)");
    expect(dark).toContain("--reader-scheme: dark");
    const light = readerVars(studioLightColors);
    expect(light).toContain(`--bg: ${studioLightColors.background}`);
    expect(light).toContain("--eq-filter: none");
    expect(light).toContain("--reader-scheme: light");
  });
  it("web CSS uses Playfair headings, no bold weight, and the gated filter", () => {
    const css = readerCss(studioDarkColors);
    expect(css).toContain("PlayfairDisplay_500Medium");
    expect(css).toContain("var(--eq-filter)");
    expect(css).not.toMatch(/h[12][^}]*font-weight:\s*700/);  // headings not bold
  });
});
```

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/reader/readerStyles.test.ts` (exports missing).

- [ ] **Step 3: Implement.** In `readerStyles.ts`:
  - Add `isDarkBackground(palette: Palette): boolean` — parse `palette.background` (`#rrggbb`) to relative luminance `(0.2126*r + 0.7152*g + 0.0722*b)/255` and return `< 0.5`.
  - Add `readerVars(palette: Palette): string` returning the `--x: y;` lines (bg/surface/surfaceHigh/border/text/text2/muted/primary/success/error/warning from `palette`), plus `--reader-scheme: ${isDarkBackground(palette) ? "dark" : "light"};` and `--eq-filter: ${isDarkBackground(palette) ? "invert(1)" : "none"};`. NO wrapping selector.
  - Replace the `export const READER_CSS = \`…\`` with `export function readerCss(palette: Palette): string` returning the same stylesheet, but: the `.mentible-reader { … }` root rule now inlines `${readerVars(palette)}` (drop the static `colors` var lines + the hardcoded `color-scheme: dark`); set `color-scheme: var(--reader-scheme);`. Add `--display: 'PlayfairDisplay_500Medium', 'Playfair Display', Georgia, 'Times New Roman', serif;` to the root vars. Change the `h1/h2/h3` rules to `font-family: var(--display)` and **remove their `font-weight: 700`/`600`** (h3 may keep 500 or drop). Change the `p img` equation rule from `filter: invert(1); mix-blend-mode: screen;` to `filter: var(--eq-filter); mix-blend-mode: screen;` (screen is harmless when filter is none, but if you prefer, gate the whole line — either is fine as long as light theme shows the equation). Replace the hardcoded `code { … color: #e2e8f0 }` with `color: var(--text2)` (or `--text`).
  - Import `Palette` from `@/constants/theme` (keep or drop the `colors` import as needed — if unused, remove it).
  - In the 3 `.web.tsx` readers: `import { readerCss, READER_ROOT_CLASS } from "@/reader/readerStyles"; import { useTheme } from "@/theme";` then inside the component `const theme = useTheme();` and `<style data-mentible-reader="">{readerCss(theme)}</style>`. Also swap the `container` style's `backgroundColor: colors.background` to the themed background (use `useThemedStyles` or `theme.background`).

- [ ] **Step 4: Run tests + tsc** — `cd mobile && npx jest __tests__/reader && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/reader/readerStyles.ts mobile/src/reader/NativeTopicReader.web.tsx mobile/src/reader/NativeQuizReader.web.tsx mobile/src/reader/NativeChapterReader.web.tsx mobile/__tests__/reader/readerStyles.test.ts
git commit -m "feat(studio): P3 theme-reactive reader CSS + Playfair headings, gated equation invert (web) (Studio P3 T1)"
```

---

### Task 2: Embedded Playfair font for the native WebView

**Files:**
- Create: `mobile/src/reader/playfairFont.ts`
- Test: `mobile/__tests__/reader/playfairFont.test.ts` (new, thin)

**Interfaces:**
- Produces: `PLAYFAIR_FONTFACE: string` — `@font-face` CSS declaring `font-family: 'Playfair Display'` at weights 400 + 500 with data-URI `src`.

- [ ] **Step 1: Locate the font files** — `ls mobile/node_modules/@expo-google-fonts/playfair-display/*.ttf` (expect `PlayfairDisplay_400Regular.ttf`, `PlayfairDisplay_500Medium.ttf`). If a `pyftsubset`/`fonttools` is available, subset each to latin + convert to woff2 for size; otherwise embed the `.ttf` directly. Encode with `base64 -w0 <file>`.

- [ ] **Step 2: Generate `playfairFont.ts`** — mirror `compiler/src/fonts.ts`'s header + shape. Two `@font-face` blocks:
```ts
// Auto-generated: Playfair Display 400 + 500 (latin) embedded as data-URI
// @font-face so the native WebView reader renders true Playfair headings,
// self-contained (no network). Source: Google Fonts (OFL).
export const PLAYFAIR_FONTFACE =
  "@font-face{font-family:'Playfair Display';font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,<...>)}" +
  "@font-face{font-family:'Playfair Display';font-style:normal;font-weight:500;font-display:swap;src:url(data:font/woff2;base64,<...>)}";
```
(Use `data:font/ttf;base64,` if you embedded ttf instead of woff2.) Note the total embedded byte size in the header comment.

- [ ] **Step 3: Write the thin test** (`playfairFont.test.ts`):
```ts
import { PLAYFAIR_FONTFACE } from "@/reader/playfairFont";
it("declares Playfair Display at two weights with embedded data URIs", () => {
  expect(PLAYFAIR_FONTFACE).toContain("font-family:'Playfair Display'");
  expect(PLAYFAIR_FONTFACE).toContain("font-weight:400");
  expect(PLAYFAIR_FONTFACE).toContain("font-weight:500");
  expect((PLAYFAIR_FONTFACE.match(/src:url\(data:font/g) || []).length).toBe(2);
});
```

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__/reader/playfairFont.test.ts && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/reader/playfairFont.ts mobile/__tests__/reader/playfairFont.test.ts
git commit -m "feat(studio): P3 embed Playfair Display (400/500) for the native reader WebView (Studio P3 T2)"
```

---

### Task 3: Native reader — theme-reactive doc + embedded Playfair + palette threading

**Files:**
- Modify: `mobile/src/components/contentHtml.ts`
- Modify: `mobile/src/components/LessonRenderer.tsx`
- Test: `mobile/__tests__/reader/contentHtml.test.ts` (new or extend existing)

**Interfaces:**
- Consumes: `readerVars`/`isDarkBackground` (T1), `PLAYFAIR_FONTFACE` (T2), `Palette`, `useTheme`.
- Produces: `buildTopicHtml(topic, figures, palette)`, `buildChapterHtml(chapter, palette)`, `buildChapterQuizHtml(quiz, palette)` — each now takes the active palette; the returned doc carries the themed vars + the embedded Playfair.

- [ ] **Step 1: Write the failing test** (`contentHtml.test.ts`), using a minimal `GeneratedTopic`:
```ts
import { buildTopicHtml } from "@/components/contentHtml";
import { studioDarkColors, studioLightColors } from "@/constants/theme";
const topic: any = { topicId: "t", title: "T", lesson: { topic: "T", level: "", language: "en", synopsis: "", learning_objectives: [], sections: [{ heading: "H", body_markdown: "x" }], key_takeaways: [], further_reading: [] }, generatedAt: "" };
it("embeds themed vars + Playfair, gating the equation filter per theme", () => {
  const dark = buildTopicHtml(topic, undefined, studioDarkColors);
  expect(dark).toContain("Playfair Display");                 // PLAYFAIR_FONTFACE injected
  expect(dark).toContain(`--bg: ${studioDarkColors.background}`);
  expect(dark).toContain("--eq-filter: invert(1)");
  const light = buildTopicHtml(topic, undefined, studioLightColors);
  expect(light).toContain(`--bg: ${studioLightColors.background}`);
  expect(light).toContain("--eq-filter: none");
});
```
(Read the real `buildTopicHtml` signature first and match the arg order — `figures` is the current 2nd param; add `palette` as the 3rd. Update the assertion topic shape to whatever the real fn needs.)

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/reader/contentHtml.test.ts`.

- [ ] **Step 3: Implement.**
  - In `contentHtml.ts`: `import { readerVars, isDarkBackground } from "@/reader/readerStyles"; import { PLAYFAIR_FONTFACE } from "@/reader/playfairFont"; import type { Palette } from "@/constants/theme";`. Change the `READER_STYLES` const into a function `readerStyles(palette: Palette): string` (or inline into the doc builder) that: inlines `${readerVars(palette)}` into its `:root`/`html` rule (drop the static `colors` vars + hardcoded `color-scheme: dark`), sets `color-scheme: var(--reader-scheme)`, adds the `--display` Playfair stack, makes headings `font-family: var(--display)` with **no `font-weight: 700`**, and uses `var(--eq-filter)` on the equation `img` rule. Prepend `PLAYFAIR_FONTFACE` to the `<style>`/`<head>`. Replace hardcoded literals (`code` color, etc.) with vars — but LEAVE the `.error-banner` literal if it reads acceptably on both (your call; prefer vars).
  - Add `palette: Palette` as the last param of `buildTopicHtml`, `buildChapterHtml`, `buildChapterQuizHtml`; pass it into `readerStyles(palette)` where the doc is assembled. Do NOT change the shared content body calls (`renderTopicToHtml`/`renderChapterToHtml`/`renderChapterQuizToHtml`).
  - In `LessonRenderer.tsx`: in `WebViewTopicRenderer`/`ChapterRenderer`/`QuizRenderer` (the native-only hosts), get the palette via `useTheme()` and pass it: `buildTopicHtml(topic, figures, theme)`, `buildChapterHtml(chapter, theme)`, `buildChapterQuizHtml(quiz, theme)`. (`useMemo` deps: add `theme`.) The re-export `export { buildTopicHtml }` stays; any other caller of these fns must pass a palette — grep for callers and update them (e.g. compiler/tests) or default the param defensively if a non-themed caller genuinely exists (note it).

- [ ] **Step 4: Run tests + tsc** — `cd mobile && npx jest __tests__/reader && npx tsc --noEmit`. Grep `buildTopicHtml|buildChapterHtml|buildChapterQuizHtml` across `mobile/` for other call sites and fix any that now miss the palette arg.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/components/contentHtml.ts mobile/src/components/LessonRenderer.tsx mobile/__tests__/reader/contentHtml.test.ts
git commit -m "feat(studio): P3 native WebView reader theme-reactive + embedded Playfair (Studio P3 T3)"
```

---

### Task 4: Verify (both themes) + read-screen chrome touch-up

**Files:**
- Modify (only if it visibly lags): `mobile/app/book/read/[id].tsx`
- Test: any existing read-screen test updated

- [ ] **Step 1: Full suite + tsc** — `cd mobile && npx jest && npx tsc --noEmit`. Grep the whole `mobile/` tree for a residual `READER_CSS` import or a build-fn call missing its palette arg — fix any.
- [ ] **Step 2: Chrome touch-up (conditional).** READ `mobile/app/book/read/[id].tsx`. If in-body controls (the download/checkout buttons, the "source book gone" block) still use raw `Pressable`/`fontWeight:700` while the P2 screens use `<Button>`/Playfair, apply the P2 pattern (`<Button variant="ghost">`, Playfair headings via `PLAYFAIR.semibold`). If it already reads consistent with P2, leave it and note so. Do NOT change any read/checkout/navigation behavior.
- [ ] **Step 3: If chrome changed, run** — `cd mobile && npx jest __tests__ -t "[Rr]ead" && npx tsc --noEmit`.
- [ ] **Step 4: Commit (only if chrome changed).**
```bash
git add "mobile/app/book/read/[id].tsx" mobile/__tests__ 2>/dev/null
git commit -m "feat(studio): P3 read-screen chrome touch-up (Studio P3 T4)"
```
- [ ] **Step 5: Manual screenshot verify (report, not code).** Note in the report that the branch needs a device/web pass: open a real book with an **inline-math equation, a Mermaid diagram, a ```svg figure, a table, and a quiz**, in BOTH studio-dark and studio-light — confirm the equation is legible in both (the invert gate), Playfair headings render (web + native embedded), diagrams/tables/quiz intact, no text-collapse.

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest` — full suite green.
- [ ] `cd mobile && npx tsc --noEmit && npx eslint .` (or the repo lint) — clean.
- [ ] No residual `READER_CSS` (const) import; every `buildTopicHtml`/`buildChapterHtml`/`buildChapterQuizHtml` call passes a palette; the static `colors` import is gone from the reader render path (or justified).
- [ ] **Both-theme screenshot verify** (the one real risk = equation-invert-on-light) on a math+diagram book, web + native device.
- [ ] PR body: theme-reactive reader (navy/paper) + Playfair (web real, native embedded) + gated equation invert; mobile-only → **web redeploy, no backend**.

## Self-Review

- **Spec coverage:** shared `readerVars`+gated invert/scheme (T1) · web `readerCss` + Playfair (T1) · embedded Playfair font (T2) · native doc + palette threading (T3) · verify + chrome (T4). Compiler exports + dyslexic-in-reader correctly out of scope.
- **Type consistency:** `readerVars`/`isDarkBackground`/`readerCss` signatures match T1's test + T3's consumption; the 3 build fns gain the same `palette: Palette` trailing param, threaded from `useTheme()` in `LessonRenderer.tsx`; `PLAYFAIR_FONTFACE` is a string consumed by T3.
- **Placeholders:** none — the helper logic (luminance, gated vars), the font-embed shape, and the threading are concrete; the base64 payloads are generated in T2 Step 1–2.
- **Correctness/constraints:** the equation invert is gated on `isDarkBackground` in the ONE shared helper both stylesheets use, so light-theme math stays legible; the shared content renderer is untouched; no color-literal asserts beyond palette token values.
