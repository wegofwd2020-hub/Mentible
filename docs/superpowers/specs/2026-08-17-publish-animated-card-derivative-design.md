# P1-5 P3 — Animated card derivative (GIF) — Design

**Status:** Approved (brainstorming, 2026-08-17). Third derivative slice of P1-5 / ADR-037 **D8** — the
[Short-Form Publishing Studio proposal](../../proposals/2026-07-27-short-form-publishing-studio.md) **Phase 3
(Animated)**, GIF path only. Builds on slice 1 (image card, #478) and slice 2 (carousel, #480).

## Context (verified — feasibility mapped 2026-08-17)

- **Frame capture is feasible with no system ffmpeg.** `page.evaluate((t) => document.querySelector('svg').
  setCurrentTime(t), t)` seeks a **SMIL**-animated SVG deterministically in headless Chromium; screenshot at
  each `t`. (CSS `@keyframes` does NOT respond to `setCurrentTime` → would capture a frozen frame, so the
  animation MUST be SMIL.)
- **GIF encode is pure-JS**: `gifenc` (RGBA → GIF) + `pngjs` (decode the PNG frames puppeteer emits) — two new
  npm deps in the compiler, **no system ffmpeg** (ffmpeg is absent from the image; MP4 is out of scope).
- **The compiler authors the card SVG directly** (`card.ts` does not go through the reader's DOMPurify), so a
  compiler-built SMIL animation is trusted — no sanitize-strip concern (DOMPurify's svg profile strips bare
  `<animate>`, but that only affects model-authored `` ```svg ``, which this slice does not use).
- **Reusable rails (all shipped):** `compiler/src/rasterize.ts` (`launchBrowser`, `rasterizeToPng`,
  `rasterizeManyToPng`, `shotSvg`, the `PuppeteerPage` interface at `rasterize.ts:7-13`); `compiler/src/card.ts`
  `buildCardSvg`/`CardInput`; `compiler/src/cli.ts` `--format` short-circuit dispatch (card/carousel);
  backend `derivatives` (`_resolve_key_and_source`, `generate_card`, `render.py compile_card_png`, the `/card`
  + `/carousel` endpoints, `CardContent`); mobile `makeCard`/`useMakeCard` + the Publish mode toggle.
- `PuppeteerPage` (`rasterize.ts:7-13`) declares `setViewport/setContent/$/screenshot/close` — **no
  `evaluate`** (real puppeteer has it; the interface is a minimal hand-rolled subset).

## Decisions (brainstorming 2026-08-17)

1. **Motion = a compiler-side SMIL preset over the existing card copy.** The LLM writes only `{headline,
   subtext}` (reuse `generate_card` — no new LLM contract); the compiler animates it. Deterministic capture,
   guaranteed on-brand, no model-authored SVG to sanitize.
2. **3 selectable presets:** `fade` (staggered opacity reveal), `slide` (slide-up + fade), `build` (scale/opacity
   build-in). Each ≈2.5s of motion + a hold, infinite loop.
3. **GIF only.** MP4 / A-V deferred until an ffmpeg-or-Remotion decision (none in the image today).
4. **Square, captured at 720²** for the GIF (keeps file size sane; the static card is 1080² but a 1080² GIF is
   large), ~12 fps → ~30 frames.
5. **Source = pasted text OR a validated section**, reusing the card's `_resolve_key_and_source` seam +
   provenance label (on the card footer), Pro/managed-or-BYOK gated, `IS_DEMO` blocked.
6. **One-shot**, consistent with the earlier slices.

## Architecture

```
Publish tab → "Animated" mode (source: text OR validated section, + preset, + tone)
   POST /api/v1/derivatives/animated   (key fork + trust seam COPIED from /card via _resolve_key_and_source)
     1. if topic_version_id → source_text + source_label
     2. generate_card (REUSED) → { headline, subtext }
     3. compiler --format animated  (stdin {headline, subtext, source_label?, preset, size:"square"})
          buildAnimatedCardSvg → branded card SVG + SMIL reveal (compiler-authored → trusted)
          rasterizeSvgFrames: setContent once → per t: page.evaluate(setCurrentTime(t)) + screenshot → N PNGs
          pngjs decode → gifenc encode → GIF Buffer  (raw GIF on stdout)
   → { card:{headline,subtext,source_label}, preset, image_gif_base64, provenance:"ai-generated" }
   → mobile: animated GIF preview (expo-image) + Download (card.gif, image/gif)
```

---

## Unit A — Compiler: frame capture + GIF encode + preset SVG

**Files:** modify `compiler/src/rasterize.ts`; create `compiler/src/animated.ts`; modify `compiler/src/cli.ts`,
`compiler/package.json` (add `gifenc`, `pngjs`); tests `compiler/__tests__/animated.test.ts`.

**Interfaces:**
- `rasterize.ts`: add `evaluate<T>(fn: string | ((...a: any[]) => T), ...args: any[]): Promise<T>` to the
  `PuppeteerPage` interface. Add `rasterizeSvgFrames(svg: string, timepoints: number[], width: number):
  Promise<Buffer[]>` — one `launchBrowser`, one page, `setContent(shellHtml(svg, width))` ONCE, then for each
  `t`: `await page.evaluate((tt) => { const s = document.querySelector('svg'); if (s && s.setCurrentTime)
  s.setCurrentTime(tt); }, t)` then screenshot the `#target` element; close the page/browser once; PNG buffers
  in order. Before the loop, `page.emulateMediaFeatures?.([{name:'prefers-reduced-motion', value:'no-preference'}])`
  (guarded — add to the interface as optional) so headless doesn't pause SMIL. `rasterizeToPng`/`rasterizeManyToPng`
  unchanged.
- `animated.ts`: `AnimatedPreset = "fade" | "slide" | "build"`; `AnimatedInput = { headline: string; subtext:
  string; source_label?: string; preset: AnimatedPreset; size: "square" }`; `buildAnimatedCardSvg(input):
  string` — extends the branded card look (fork `buildCardSvg`'s panel/palette/fonts) with a `<g>` per text
  block carrying SMIL: `fade` = `<animate attributeName="opacity" from="0" to="1" begin="…" dur="0.6s"
  fill="freeze"/>` staggered per block; `slide` = the opacity animate + `<animateTransform type="translate"
  from="0 40" to="0 0" .../>`; `build` = opacity + `<animateTransform type="scale" from="0.9" to="1" .../>`
  about the block centre. Total animated span `_DURATION_S` (2.5) then hold; `<svg>` root gets no CSS animation.
  `compileAnimated(input): Promise<Buffer>` — `buildAnimatedCardSvg` → `timepoints` = `[0, 1/FPS, …, HOLD_END]`
  (`FPS=12`, `HOLD_END = _DURATION_S + 0.8` ⇒ ~40 frames) → `rasterizeSvgFrames(svg, timepoints, 720)` → decode
  each PNG with `pngjs` (`PNG.sync.read`) to RGBA → `gifenc` (`quantize` + `applyPalette` + `GIFEncoder`, delay
  `1000/FPS` ms, `repeat: 0` = infinite) → GIF `Buffer`.
- CLI `--format animated`: reads an `AnimatedInput` JSON on stdin → `compileAnimated` → GIF on stdout; short-
  circuit before the `Book` parse (mirror the `card` branch); leave the other formats intact.

**Tests (CI-safe — no real puppeteer):**
- `buildAnimatedCardSvg` for each preset contains the headline/subtext text AND the expected SMIL element
  (`<animate` for fade; `<animateTransform` type translate/scale for slide/build); `viewBox 0 0 720 720`.
- `rasterizeSvgFrames` throws the absent-puppeteer contract (like `rasterize.test.ts`).
- GIF encode is exercised on 2 fixture RGBA frames (call the encode helper directly, no Chromium) → the Buffer
  starts with the `GIF89a` signature. (Factor the RGBA→GIF step into a small pure `encodeGif(frames: {data:
  Uint8Array; width; height}[], fps): Buffer` so it's unit-testable without capture.)

## Unit B — Backend: animated endpoint (reuses generate_card)

**Files:** modify `backend/src/derivatives/{schemas.py, render.py, router.py}`; tests
`backend/tests/test_derivatives_animated_endpoint.py`.

**Interfaces:**
- `schemas.py`: `AnimatedPreset = Literal["fade","slide","build"]`; `AnimatedRequest {source_text?,
  topic_version_id: uuid.UUID|None, preset: AnimatedPreset="fade", tone?, api_key?, provider_id="anthropic",
  model?}` with the `_exactly_one_source` + `_known_provider` validators (mirror `CardRequest`); `AnimatedResponse
  {card: CardContent, preset: AnimatedPreset, image_gif_base64: str, provenance: str="ai-generated"}`.
- `render.py compile_animated_gif(card_input: dict) -> bytes` — subprocess `--format animated`, stdin the
  `AnimatedInput` JSON, raw GIF bytes on stdout; timeout, `CardRenderError` on failure (mirror
  `compile_card_png`).
- `router.py POST /api/v1/derivatives/animated` → `AnimatedResponse`. Reuse `_resolve_key_and_source(body,
  request, principal)` for the key fork + trust seam (managed 400/429; `topic_version_id` → 401/404/403;
  `source_text` + `source_label`). Then `generate_card` (off-loop `asyncio.to_thread`, size irrelevant — pass
  `size="square"` since generate_card takes a size; the copy doesn't vary meaningfully) → build the
  `AnimatedInput` dict `{headline, subtext, source_label, preset: body.preset, size:"square"}` (source_label
  from the seam) → `compile_animated_gif` → `AnimatedResponse`. `LLMSchemaError`/`CardRenderError` → 502; the
  key/content never logged.

**Tests:** animated 200 from `source_text` (mock provider, stub `compile_animated_gif` → `b"GIF89a..."`,
`image_gif_base64` matches); both/neither source → 422; `topic_version_id` member → 200 w/ `card.source_label`,
non-member → 403, missing → 404, malformed id → 422; managed 400 / over-cap 429; an invalid `preset` → 422; key
not in `caplog`.

## Unit C — Mobile: animated mode

**Files:** modify `mobile/src/api/derivativesClient.ts`, `mobile/app/(tabs)/posts.tsx`, `mobile/src/help-content/
{features.ts, topics.ts}`, `mobile/package.json` (ensure `expo-image`); create `mobile/src/hooks/useMakeAnimated.ts`;
tests `mobile/__tests__/screens/Publish.animated.test.tsx`.

**Interfaces:**
- `derivativesClient.ts`: `AnimatedPreset = "fade"|"slide"|"build"`; `MakeAnimatedResponse {card:{headline,
  subtext,source_label:string|null}; preset: AnimatedPreset; image_gif_base64: string; provenance: string}`;
  `makeAnimated(req: {source_text?|topic_version_id?, preset: AnimatedPreset, tone?, api_key?, provider_id?,
  model?}): Promise<MakeAnimatedResponse>` → `POST /derivatives/animated` (mirror `makeCard`; `IS_DEMO` blocks).
- `useMakeAnimated` — mirror `useMakeCard`'s `knownNotPro` gate; `RunArgs` = `{source_text?, topic_version_id?,
  preset, tone?}`.
- `posts.tsx`: the mode toggle gains **"Animated"**. Animated mode reuses the shared source picker
  (`renderSourcePicker("Animated")`), adds a **preset selector** (Fade · Slide-up · Build-in), tone, "Make
  animated card" → renders the GIF with **`expo-image`**'s `<Image source={{ uri: \`data:image/gif;base64,
  ${result.image_gif_base64}\` }} style={{ aspectRatio: 1 }} />` (expo-image animates GIF/WebP cross-platform;
  RN core `<Image>` shows only a static frame on Android — if `expo-image` isn't a dep, `npx expo install
  expo-image`) + **Download** (`downloadArtifact(fromBase64(result.image_gif_base64), "card.gif", "image/gif")`).
  Do NOT regress the post/card/carousel modes.
- **Help DoD:** add a `publish-animated` `FEATURES` key + a Help topic (or extend `publish-card`) describing the
  animated GIF card + presets, or `help/coverage.test.ts` fails.

**Tests:** animated mode renders the GIF (data URI) + the preset selector + Download; "Make animated card" from
text calls `makeAnimated({source_text, preset})`, from a section `{topic_version_id}`; changing the preset passes
it; known-not-Pro without a key blocks.

---

## Cross-cutting / global constraints

- **BYOK/ADR-001:** the copy LLM call obeys the derivatives discipline — key never logged/persisted; source
  text + section content + frame copy never logged; key resolved via managed vault or the BYOK body.
- **Access:** a `topic_version_id` animated card is gated by `require_project_access` (owner/reviewer/editor);
  flat `source_text` needs no trust access.
- **Gating:** Pro/managed-or-BYOK, paid app only; `IS_DEMO` blocks. Render is free (Chromium already in the
  image); the only billable step is the LLM copy (via `generate_card`).
- **Animation must be SMIL** (not CSS) so `setCurrentTime` seeks deterministically — the compiler authors only
  SMIL; a CI test asserts the preset SVG carries SMIL animation elements.
- **New compiler deps `gifenc` + `pngjs`** are pure-JS (no native binary, no system ffmpeg) — they ride the
  existing compiler build in the api image.
- No migration. asyncpg; no key/content in logs; 70% coverage. Backend CI runs BOTH `ruff check` and `ruff
  format --check` — run `ruff format backend/` before committing. No `backend/__init__.py`, no conftest/
  test_dbsafety edits. Mobile: `useThemedStyles`; no color-literal test asserts; `tsc`/`jest`/`eslint` green.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Decomposition (SDD)

- **T1 — Compiler capture + encode + presets (Unit A):** `evaluate` on `PuppeteerPage` + `rasterizeSvgFrames`;
  `animated.ts` (`buildAnimatedCardSvg` 3 presets, `encodeGif`, `compileAnimated`); `--format animated` CLI;
  `gifenc`+`pngjs` deps. Tests (preset SMIL, absent-puppeteer, GIF89a from fixture RGBA).
- **T2 — Backend animated endpoint (Unit B):** `AnimatedRequest`/`AnimatedResponse` + `compile_animated_gif` +
  `POST /derivatives/animated` (reuse `_resolve_key_and_source` + `generate_card`). Tests.
- **T3 — Mobile animated mode (Unit C):** `makeAnimated` + `useMakeAnimated` + the Publish animated mode
  (preset selector + expo-image GIF preview + Download) + Help. Tests.

(T1 gates T2's render; T2 gates T3. T1 is the only genuinely-new-code task; T2/T3 are clones of the card path.)

## Rollout

Backend refresh (new endpoint + the compiler's `--format animated` + the 2 new npm deps in the api image;
Chromium already present) + web deploy + APK. No migration.

## Out of scope / follow-ups

- **MP4 / audio / A-V** (needs ffmpeg or Remotion — a separate infra decision).
- LLM-authored motion (structured beats or raw animated-SVG); animated **diagrams**; more presets; per-frame
  timing control; animating a **carousel**; GIF frame-count/fps tuning UI.
- A "my validated versions" endpoint (the picker's N+1, carried from slice 1).

## Open (non-blocking)

- GIF file size at 720²/~40 frames — the navy/gold card palette quantizes to few colours so `gifenc` should keep
  it small; if a real render is heavy, drop to ~600² or 10 fps (both one-line changes).
- `expo-image` availability — if not already a dependency, `expo install expo-image` (a standard Expo package);
  T3 confirms and adds it if missing.
