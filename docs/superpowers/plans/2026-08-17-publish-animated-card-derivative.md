# P1-5 P3 — Publish animated card derivative (GIF) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an owned source into a short animated GIF card — a branded card whose headline/subtext animate in via a compiler-authored SMIL preset — captured frame-by-frame in headless Chromium and encoded with a pure-JS GIF encoder (no ffmpeg), on the Publish tab.

**Architecture:** The LLM writes only the card copy (reuse `generate_card`); the compiler builds a branded SMIL-animated card SVG for one of three presets, seeks it with `page.evaluate(setCurrentTime(t))` + screenshot at N timepoints (`rasterizeSvgFrames`), decodes the PNG frames with `pngjs` and encodes a GIF with `gifenc`. A new backend `POST /derivatives/animated` reuses the card slice's `_resolve_key_and_source` seam. Mobile adds an animated mode with a preset selector and an `expo-image` GIF preview.

**Tech Stack:** Node/TypeScript compiler (jest, headless-Chromium, `gifenc` + `pngjs`), FastAPI + asyncpg (pytest), React Native + Expo (jest, `expo-image`).

**Spec:** `docs/superpowers/specs/2026-08-17-publish-animated-card-derivative-design.md`

## Global Constraints

- **Motion is a COMPILER-authored SMIL preset over the card copy** — reuse `generate_card` (LLM writes `{headline, subtext}`); NO model-authored SVG. Animation MUST be SMIL (`<animate>`/`<animateTransform>`), never CSS, so `page.evaluate(svg.setCurrentTime(t))` seeks deterministically.
- **GIF only** (MP4/audio deferred — no ffmpeg in the image). Square, captured at **720²**, `FPS=12`, `_DURATION_S=2.5` motion + `0.8s` hold → ~40 frames, infinite loop.
- **New compiler deps:** `gifenc` + `pngjs` (both pure-JS, no native binary/ffmpeg).
- **Heavy reuse:** `compiler/src/card.ts buildCardSvg`/`CardInput`; `rasterize.ts` (`launchBrowser`, `shellHtml`, `shotSvg`, the `PuppeteerPage` interface); `cli.ts` `--format` short-circuit; backend `_resolve_key_and_source`, `generate_card`, `render.py compile_card_png`, `CardContent`; mobile `makeCard`/`useMakeCard`, the Publish mode toggle + `renderSourcePicker`.
- **BYOK/ADR-001:** key never logged/persisted; source text + section content + copy never logged. Access: `topic_version_id` gated by `require_project_access`. Pro/managed-or-BYOK; `IS_DEMO` blocks. No migration.
- Backend CI runs BOTH `ruff check` and `ruff format --check` — run `ruff format backend/` before committing. Never create `backend/__init__.py` / touch conftest / test_dbsafety; run backend tests with `.venv/bin/python -m pytest`.
- Mobile: `useThemedStyles`; no color-literal test asserts; `tsc`/`jest`/`eslint` green. **Help DoD:** add `publish-animated` FEATURES key + Help topic in T3 (or `help/coverage.test.ts` fails).
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Canonical shapes (every task uses these exact names)

```
AnimatedPreset = "fade" | "slide" | "build"
AnimatedInput  = { headline, subtext, source_label?, preset: AnimatedPreset, size: "square" }   # compiler stdin
CardContent    = { headline, subtext, source_label: str|None }                                  # reused from card slice
AnimatedResponse = { card: CardContent, preset: AnimatedPreset, image_gif_base64: str, provenance: "ai-generated" }
AnimatedRequest  = { source_text?|topic_version_id? (exactly one), preset: AnimatedPreset="fade", tone?, api_key?, provider_id="anthropic", model? }
```

---

## Task 1: Compiler — frame capture + GIF encode + preset SVG

**Files:** Modify `compiler/src/rasterize.ts`, `compiler/src/cli.ts`, `compiler/package.json`; Create `compiler/src/animated.ts`; Test `compiler/__tests__/animated.test.ts`.

**Interfaces:**
- Consumes: `buildCardSvg`/`CardInput` (card.ts); `launchBrowser`, `shellHtml`, the `PuppeteerPage` interface (rasterize.ts — module-private, so `rasterizeSvgFrames` lives IN rasterize.ts).
- Produces: `rasterizeSvgFrames(svg, timepoints, width): Promise<Buffer[]>`; `AnimatedPreset`, `AnimatedInput`, `buildAnimatedCardSvg`, `encodeGif`, `compileAnimated` (animated.ts); CLI `--format animated`.

- [ ] **Step 1: Add the deps**

```bash
cd compiler && npm install gifenc pngjs && npm install -D @types/pngjs
```
Confirm `compiler/package.json` lists `gifenc` + `pngjs` in dependencies (both pure-JS).

- [ ] **Step 2: Write the failing tests** (CI-safe — no real puppeteer)

```ts
// compiler/__tests__/animated.test.ts
import { buildAnimatedCardSvg, encodeGif } from "../src/animated";
import { rasterizeSvgFrames } from "../src/rasterize";

const base = { headline: "Trust is the product", subtext: "Every claim traces to a source.", size: "square" as const };

it("each preset builds a 720 square SVG with SMIL animation + the copy", () => {
  const smil = { fade: "<animate", slide: "<animateTransform", build: "<animateTransform" } as const;
  for (const preset of ["fade", "slide", "build"] as const) {
    const svg = buildAnimatedCardSvg({ ...base, preset });
    expect(svg).toContain('viewBox="0 0 720 720"');
    expect(svg).toContain("Trust is the product");
    expect(svg).toContain("Every claim traces to a source.");
    expect(svg).toContain(smil[preset]);
    expect(svg).not.toContain("@keyframes"); // must be SMIL, not CSS (setCurrentTime can't seek CSS)
  }
});

it("rasterizeSvgFrames throws the puppeteer-absent contract (CI-safe)", async () => {
  await expect(rasterizeSvgFrames("<svg/>", [0, 0.1], 720)).rejects.toThrow(/puppeteer/i);
});

it("encodeGif turns RGBA frames into a GIF89a buffer", () => {
  const w = 2, h = 2;
  const red = new Uint8Array([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]);
  const blue = new Uint8Array([0,0,255,255, 0,0,255,255, 0,0,255,255, 0,0,255,255]);
  const gif = encodeGif([{ data: red, width: w, height: h }, { data: blue, width: w, height: h }], 12);
  expect(gif.subarray(0, 6).toString("latin1")).toBe("GIF89a");
  expect(gif.length).toBeGreaterThan(20);
});
```

- [ ] **Step 3: Run — expect FAIL** (`cd compiler && npx jest animated`)

- [ ] **Step 4: Add `evaluate` + `rasterizeSvgFrames` to `rasterize.ts`**

Add `evaluate` (and optional `emulateMediaFeatures`) to the `PuppeteerPage` interface, then the capture fn:

```ts
// rasterize.ts — extend the interface:
interface PuppeteerPage {
  setViewport(v: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  $(sel: string): Promise<PuppeteerEl | null>;
  screenshot(opts: { type: "png"; omitBackground?: boolean }): Promise<Uint8Array>;
  evaluate<T>(fn: string | ((...a: unknown[]) => T), ...args: unknown[]): Promise<T>;
  emulateMediaFeatures?(features: { name: string; value: string }[]): Promise<void>;
  close(): Promise<void>;
}

// One animated SVG, N timepoints. setContent ONCE, then seek+screenshot per frame.
export async function rasterizeSvgFrames(svg: string, timepoints: number[], width: number): Promise<Buffer[]> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures?.([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await page.setViewport({ width, height: 2000, deviceScaleFactor: 2 });
    await page.setContent(shellHtml(svg, width));
    const out: Buffer[] = [];
    for (const t of timepoints) {
      await page.evaluate((tt) => {
        const s = document.querySelector("svg") as (SVGSVGElement | null);
        if (s && typeof s.setCurrentTime === "function") { s.pauseAnimations?.(); s.setCurrentTime(tt); }
      }, t);
      const el = await page.$("#target");
      const buf = el ? await el.screenshot({ type: "png" }) : await page.screenshot({ type: "png" });
      out.push(Buffer.from(buf));
    }
    return out;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 5: Implement `animated.ts`**

```ts
// compiler/src/animated.ts
import { PNG } from "pngjs";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { buildCardSvg, type CardInput } from "./card";
import { rasterizeSvgFrames } from "./rasterize";

export type AnimatedPreset = "fade" | "slide" | "build";
export interface AnimatedInput {
  headline: string;
  subtext: string;
  source_label?: string;
  preset: AnimatedPreset;
  size: "square";
}

const SQUARE = 720;
const FPS = 12;
const DURATION_S = 2.5;
const HOLD_END = DURATION_S + 0.8;

// A branded animated card: the static card SVG (from buildCardSvg) with a SMIL
// wrapper <g> per text block. We author the SMIL ourselves (trusted — never
// through the reader's DOMPurify), so <animate>/<animateTransform> survive.
export function buildAnimatedCardSvg(input: AnimatedInput): string {
  const base = buildCardSvg({ headline: input.headline, subtext: input.subtext, source_label: input.source_label, size: "square" });
  // buildCardSvg emits a 1080 viewBox; re-target to 720 for the GIF and inject SMIL.
  const svg720 = base.replace(/viewBox="0 0 \d+ \d+"/, `viewBox="0 0 ${SQUARE} ${SQUARE}"`)
                     .replace(/width="\d+" height="\d+"/, `width="${SQUARE}" height="${SQUARE}"`);
  // Wrap the whole content group in a SMIL animation appropriate to the preset.
  // (buildCardSvg's children are text/rect nodes directly under <svg>; wrap them.)
  const inner = svg720.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const open = svg720.match(/^<svg[^>]*>/)?.[0] ?? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SQUARE} ${SQUARE}">`;
  const anim = presetAnim(input.preset);
  return `${open}<g opacity="0">${anim}${inner}</g></svg>`;
}

// SMIL for the wrapper <g>. Each preset animates opacity (+ a transform) and freezes.
function presetAnim(preset: AnimatedPreset): string {
  const fade = `<animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.7s" fill="freeze"/>`;
  if (preset === "fade") return fade;
  if (preset === "slide")
    return fade + `<animateTransform attributeName="transform" type="translate" from="0 48" to="0 0" begin="0s" dur="0.7s" fill="freeze"/>`;
  // build
  return fade + `<animateTransform attributeName="transform" type="scale" from="0.92" to="1" begin="0s" dur="0.7s" additive="sum" fill="freeze"/>`;
}

// Pure RGBA→GIF, unit-testable without Chromium.
export function encodeGif(frames: { data: Uint8Array; width: number; height: number }[], fps: number): Buffer {
  const enc = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (const f of frames) {
    const palette = quantize(f.data, 256);
    const index = applyPalette(f.data, palette);
    enc.writeFrame(index, f.width, f.height, { palette, delay });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}

export async function compileAnimated(input: AnimatedInput): Promise<Buffer> {
  const svg = buildAnimatedCardSvg(input);
  const timepoints: number[] = [];
  for (let t = 0; t <= HOLD_END + 1e-9; t += 1 / FPS) timepoints.push(Number(t.toFixed(4)));
  const pngs = await rasterizeSvgFrames(svg, timepoints, SQUARE);
  const frames = pngs.map((buf) => {
    const png = PNG.sync.read(buf);
    return { data: new Uint8Array(png.data), width: png.width, height: png.height };
  });
  return encodeGif(frames, FPS);
}
```

> Implementer note: confirm `buildCardSvg`'s actual root `<svg …>` attributes (width/height/viewBox) and child structure — the `svg720`/`inner` regexes above assume a single top-level `<svg>` with text/rect children (true per card.ts). If `buildCardSvg` nests content in an outer `<g>` already, wrap accordingly. `gifenc`'s exact export names (`GIFEncoder`, `quantize`, `applyPalette`) and `writeFrame` signature are per gifenc's README — verify against the installed version and adjust if the API differs (e.g. `enc.writeFrame(index, w, h, {palette, delay})`).

- [ ] **Step 6: Dispatch `--format animated` in `cli.ts`** (mirror the `card` short-circuit)

```ts
// cli.ts — import
import { compileAnimated, type AnimatedInput } from "./animated";
// Format union: add "animated"
// parseArgs --format arm: add `f === "animated" ? "animated" :`
// beside the card/carousel short-circuits, BEFORE the Book parse:
if (format === "animated") {
  const out = await compileAnimated(JSON.parse(raw) as AnimatedInput);
  process.stdout.write(out);
  return;
}
```

- [ ] **Step 7: Run — expect PASS** (`cd compiler && npx jest animated card cover && npx tsc --noEmit`, then full `npx jest`).

- [ ] **Step 8: Commit**

```bash
git add compiler/src/rasterize.ts compiler/src/animated.ts compiler/src/cli.ts compiler/package.json compiler/package-lock.json compiler/__tests__/animated.test.ts
git commit -m "feat(compiler): animated GIF card (SMIL capture + gifenc encode, --format animated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend — animated endpoint (reuses generate_card)

**Files:** Modify `backend/src/derivatives/{schemas.py, render.py, router.py}`; Test `backend/tests/test_derivatives_animated_endpoint.py`.

**Interfaces:**
- Consumes: `_resolve_key_and_source`, `generate_card`, `CardContent` (existing); compiler `--format animated` (T1).
- Produces: `AnimatedRequest`/`AnimatedResponse` (schemas); `render.compile_animated_gif(card_input) -> bytes`; `POST /api/v1/derivatives/animated`.

- [ ] **Step 1: `compile_animated_gif` in `render.py`** (mirror `compile_card_png` — raw bytes)

```python
async def compile_animated_gif(card_input: dict) -> bytes:
    """Compile an AnimatedInput dict into animated GIF bytes via the Node
    compiler's `--format animated` mode. Raises CardRenderError on failure."""
    argv = [settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", "animated"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise CardRenderError("compiler runtime unavailable") from exc
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=json.dumps(card_input).encode()),
            timeout=settings.export_timeout_seconds,
        )
    except TimeoutError as exc:
        proc.kill(); await proc.wait()
        raise CardRenderError("animated render timed out") from exc
    if proc.returncode != 0:
        log.error("animated_render_failed", returncode=proc.returncode, stderr_len=len(stderr))
        raise CardRenderError("animated render failed")
    return stdout
```

- [ ] **Step 2: Schemas** (`schemas.py`, beside `CardRequest`)

```python
AnimatedPreset = Literal["fade", "slide", "build"]

class AnimatedRequest(BaseModel):
    source_text: str | None = Field(default=None, min_length=1, max_length=20000)
    topic_version_id: uuid.UUID | None = None
    preset: AnimatedPreset = "fade"
    tone: str | None = None
    api_key: str | None = Field(default=None, min_length=20, max_length=512)
    provider_id: str = "anthropic"
    model: str | None = None

    @field_validator("provider_id")
    @classmethod
    def _known_provider(cls, v: str) -> str:
        if v not in PROVIDER_REGISTRY:
            raise ValueError(f"unknown provider: {v}")
        return v

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "AnimatedRequest":
        if bool(self.source_text) == bool(self.topic_version_id):
            raise ValueError("provide exactly one of source_text or topic_version_id")
        return self

class AnimatedResponse(BaseModel):
    card: CardContent
    preset: AnimatedPreset
    image_gif_base64: str
    provenance: str = "ai-generated"
```

- [ ] **Step 3: Write the failing endpoint test** (mirror `test_derivatives_card_endpoint.py`; stub `compile_animated_gif` → `b"GIF89a\x00\x00"`, mock provider via fake_provider)

```python
# backend/tests/test_derivatives_animated_endpoint.py (adapt the card-endpoint harness)
# - 200 from source_text + BYOK key → body.card present, body.preset echoed,
#   image_gif_base64 == base64("GIF89a..") ; key not in caplog.
# - both/neither source → 422; invalid preset "spin" → 422.
# - topic_version_id member → 200 w/ card.source_label; non-member → 403; missing → 404; malformed id → 422.
# - managed-ineligible → 400; over-cap → 429.
```

- [ ] **Step 4: Run — expect FAIL** (404); **Step 5: Endpoint** (`router.py`)

```python
@router.post("/animated", response_model=AnimatedResponse, dependencies=[Depends(enforce_rate_limit)])
async def make_animated(body: AnimatedRequest, request: Request,
                        principal: Principal | None = Depends(optional_user)) -> AnimatedResponse:
    api_key, model, source_text, source_label = await _resolve_key_and_source(body, request, principal)
    try:
        card = await asyncio.to_thread(
            generate_card, source_text=source_text, size="square", tone=body.tone,
            provider_id=body.provider_id, api_key=api_key, model=model)
    except LLMSchemaError:
        log.warning("animated_validation_failed", preset=body.preset)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not generate the card copy") from None
    # (keep the LLMAuthError/RateLimit/Error arms parallel to make_card)
    label = source_label if body.topic_version_id is not None else card.source_label
    card_input = {"headline": card.headline, "subtext": card.subtext, "source_label": label,
                  "preset": body.preset, "size": "square"}
    try:
        gif = await compile_animated_gif(card_input)
    except CardRenderError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not render the animated card") from None
    return AnimatedResponse(
        card=CardContent(headline=card.headline, subtext=card.subtext, source_label=label),
        preset=body.preset, image_gif_base64=base64.b64encode(gif).decode(), provenance="ai-generated")
```

Add imports: `AnimatedRequest, AnimatedResponse` (schemas), `compile_animated_gif` (render). `base64`, `CardContent`, `generate_card`, `_resolve_key_and_source`, `LLMSchemaError`, `CardRenderError` already imported.

`_resolve_key_and_source`'s type hint is a `CardRequest | CarouselRequest` union — widen it to include `AnimatedRequest` (all three share `source_text`/`topic_version_id`/`api_key`/`provider_id`/`model`).

- [ ] **Step 6: Run — expect PASS**; **Step 7: `ruff format backend/ && ruff check backend/`** + confirm no-key-in-logs (`.venv/bin/python -m pytest tests/ -k "log or redact" -q`); **Step 8: Commit**

```bash
git add backend/src/derivatives/schemas.py backend/src/derivatives/render.py backend/src/derivatives/router.py backend/tests/test_derivatives_animated_endpoint.py
git commit -m "feat(derivatives): /animated endpoint — GIF card via generate_card + preset

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Mobile — animated mode

**Files:** Modify `mobile/src/api/derivativesClient.ts`, `mobile/app/(tabs)/posts.tsx`, `mobile/src/help-content/{features.ts, topics.ts}`, `mobile/package.json` (ensure `expo-image`); Create `mobile/src/hooks/useMakeAnimated.ts`; Test `mobile/__tests__/screens/Publish.animated.test.tsx`.

**Interfaces:**
- Consumes: `POST /api/v1/derivatives/animated` (T2); `downloadArtifact`/`fromBase64`; the shared source picker + `renderSourcePicker` in posts.tsx.
- Produces: `makeAnimated`, `MakeAnimatedResponse`, `AnimatedPreset`; `useMakeAnimated`; the Publish animated mode.

- [ ] **Step 1: Ensure `expo-image`** — if `mobile/package.json` lacks `expo-image`, run `cd mobile && npx expo install expo-image` (needed so the GIF PREVIEW animates; RN core `<Image>` shows only a static frame for GIF on Android). If already present, skip.

- [ ] **Step 2: Client call** (`derivativesClient.ts` — mirror `makeCard`)

```ts
export type AnimatedPreset = "fade" | "slide" | "build";
export interface MakeAnimatedResponse {
  card: { headline: string; subtext: string; source_label: string | null };
  preset: AnimatedPreset; image_gif_base64: string; provenance: string;
}
export async function makeAnimated(req: {
  source_text?: string; topic_version_id?: string; preset: AnimatedPreset; tone?: string;
  api_key?: string; provider_id?: string; model?: string;
}): Promise<MakeAnimatedResponse> {
  if (IS_DEMO) throw new Error("Making an animated card is disabled in this demo build.");
  const res = await fetch(`${resolveBaseUrl()}/api/v1/derivatives/animated`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req),
  });
  if (!res.ok) { const b = await res.text().catch(() => ""); throw new ApiError(res.status, b); }
  return res.json() as Promise<MakeAnimatedResponse>;
}
```

- [ ] **Step 3: `useMakeAnimated`** — copy `useMakeCard.ts`, swapping to `makeAnimated`/`MakeAnimatedResponse`; `RunArgs = { source_text?, topic_version_id?, preset, tone? }`.

- [ ] **Step 4: Write the failing test**

```tsx
// mobile/__tests__/screens/Publish.animated.test.tsx  (mirror Publish.card.test.tsx)
// - switch to Animated mode → source field + preset selector (Fade/Slide-up/Build-in) render
// - "Make animated card" from text calls makeAnimated with { source_text, preset:"fade" }
// - selecting "Slide-up" then Make → preset:"slide"
// - a returned MakeAnimatedResponse renders the GIF <Image> (data:image/gif URI) + Download; pressing Download calls downloadArtifact with "image/gif"
// - picking a validated section calls makeAnimated with { topic_version_id }
// - known-not-Pro without a key blocks
```

- [ ] **Step 5: Animated mode in `posts.tsx`** — widen `mode` to include `"animated"`; add `useMakeAnimated` + an `animatedResult` + a `preset` state (`"fade"|"slide"|"build"`). Animated mode reuses `renderSourcePicker("Animated")` (the T4-carousel factoring), adds a **preset selector** (Fade · Slide-up · Build-in), tone, "Make animated card" → wired to `useMakeAnimated`. On result, render the GIF with **expo-image**: `import { Image as ExpoImage } from "expo-image"; <ExpoImage source={{ uri: \`data:image/gif;base64,${animatedResult.image_gif_base64}\` }} style={{ width: "100%", aspectRatio: 1 }} contentFit="contain" />` + the copy + a **Download** button:

```ts
const onDownloadAnimated = useCallback(async () => {
  if (!animatedResult) return;
  await downloadArtifact(fromBase64(animatedResult.image_gif_base64), "card.gif", "image/gif");
}, [animatedResult]);
```

Do NOT regress the post/card/carousel modes.

- [ ] **Step 6: Help DoD** — add a `publish-animated` key to `features.ts` + a Help topic in `topics.ts` with that `featureKey` (animated GIF card from your own content, 3 motion presets, download-only). Keep `help/coverage.test.ts` green.

- [ ] **Step 7: Run the gates** (`cd mobile && npx tsc --noEmit && npx jest && npx eslint .` — all green incl. help/coverage + the new test); **Step 8: Commit**

```bash
git add mobile/src/api/derivativesClient.ts mobile/src/hooks/useMakeAnimated.ts "mobile/app/(tabs)/posts.tsx" mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/package.json mobile/package-lock.json mobile/__tests__/screens/Publish.animated.test.tsx
git commit -m "feat(publish): animated GIF card mode — presets + expo-image preview (P1-5 P3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Unit A→T1 (rasterizeSvgFrames + animated.ts presets/encode + `--format animated` + deps); Unit B→T2 (schemas + compile_animated_gif + endpoint reusing _resolve_key_and_source + generate_card); Unit C→T3 (client/hook/animated mode/preset selector/expo-image/Download/Help). All covered. Deferred items (MP4/audio, LLM-authored motion, animated diagrams) out-of-scope in spec + plan.

**Placeholder scan:** T2's endpoint reuses `_resolve_key_and_source` + `generate_card` (named, exact) instead of re-deriving the seam; the LLMAuthError/RateLimit arms are "parallel to make_card" (the exact pattern shipped + reviewed twice). Every new piece (capture fn, preset SVG + SMIL, GIF encode, the endpoint tail, schemas) is given in full. The one flagged verification (buildCardSvg's exact root attrs / gifenc API names) is a "confirm against the installed code" note with a concrete fallback, not an unspecified blank.

**Type consistency:** `AnimatedInput{headline,subtext,source_label?,preset,size}` (compiler stdin) matches the `card_input` dict the backend writes; `CardContent` reused; `AnimatedResponse{card,preset,image_gif_base64,provenance}` identical in backend schemas, endpoint return, and mobile `MakeAnimatedResponse`. `AnimatedPreset` values `fade|slide|build` identical in compiler, backend Literal, mobile type, and the preset selector. Square 720 lives in one place (`SQUARE` in animated.ts). The provenance label is applied once (T2, `label`).

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-08-17-publish-animated-card-derivative.md`. Order T1→T2→T3 (T1 gates T2's render; T2 gates T3). T1 is the only genuinely-new-code task.
