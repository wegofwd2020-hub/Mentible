# P1-5 slice 2 — Carousel derivative — Design

**Status:** Approved (brainstorming, 2026-08-17). Second slice of P1-5 / ADR-037 **D8** — the
[Short-Form Publishing Studio proposal](../../proposals/2026-07-27-short-form-publishing-studio.md) **Phase 2
(Carousel)**. Builds directly on **slice 1** (the image/quote card — spec
`2026-08-17-publish-image-card-derivative-design.md`, shipped as #478).

## Context (verified — slice 1 is live)

The single **image card** shipped and everything the carousel needs already exists:
- `compiler/src/card.ts` `buildCardSvg(input: CardInput): string` + `compileCard(input): Promise<Buffer>`
  (`CardInput = {headline, subtext, source_label?, size: "square"|"linkedin"|"story"}`); `--format card` CLI
  short-circuit (`cli.ts:59`).
- `compiler/src/rasterize.ts` `rasterizeToPng({svg, width})` — launches **one** headless-Chromium browser per
  call, screenshots `#target`, closes it (`rasterize.ts:38-73`).
- Backend `backend/src/derivatives/`: `POST /derivatives/card` (`router.py make_card`) with the managed/BYOK
  **key fork** (copied from `make_post`), the **trust seam** (validated `topic_version_id` → `source_text`
  from `content.sections` + `source_label = "Based on {n} cited source(s)"` from distinct `source_ids`,
  access-gated via `require_project_access`, `ProjectAccessError`→403), `generate_card` (the `wegofwd_llm`
  seam), and `render.py compile_card_png` (compiler subprocess, `--format card`, stdin JSON → stdout PNG).
  `CardRequest`/`CardContent`/`CardResponse` schemas.
- Mobile: `derivativesClient.ts makeCard`, `useMakeCard`, the Publish screen's card mode + the validated-
  section picker + the `!IS_DEMO` "Publish" tab.

## Decisions (brainstorming 2026-08-17)

1. **Carousel = N ordered branded frames** (frame 1 hook/cover → middle one-point-each → last CTA/source)
   from an owned source (pasted text OR a validated section).
2. **N is LLM-decided, bounded 4–8** — the model splits the source; the user picks only source + tone.
3. **Batch render — a new compiler `--format carousel`** renders all N frames in **one** Chromium process
   (vs N launches), emitting a JSON envelope `{png_base64: string[]}`.
4. **Square 1080² only** this slice (carousels are square/portrait; the slice-1 `linkedin`/`story` sizes are
   a banner/story, not a carousel). Other aspects (4:5) are a follow-up.
5. **Separate PNGs + "Download all"** — the frames download as individual images (how platforms ingest a
   carousel), with per-frame preview + copy.
6. **Provenance label on the last frame only** (the source/CTA slide), not every frame.
7. **One-shot** (no per-frame copy-edit), consistent with slice 1.

## Architecture

```
Publish tab → "Carousel" mode (source: text OR validated section, + tone)
   POST /api/v1/derivatives/carousel   (key fork + trust seam COPIED from /derivatives/card)
     1. if topic_version_id → load version (access-gated) → source_text + source_label   [reuse the card seam]
     2. generate_carousel (generate_validated seam) → N frames (4–8): [{headline, subtext}]
     3. compiler --format carousel  (stdin {frames:[CardInput,...]}, ONE Chromium → N PNGs, stdout {png_base64:[...]})
   → { frames: [{card:{headline,subtext,source_label}, image_png_base64}], provenance:"ai-generated" }
   → mobile: horizontal pager of N frames + per-frame copy + "Download all" (frame-1.png … frame-N.png)
```

---

## Unit A — Compiler: batch renderer (`--format carousel`)

**Files:** modify `compiler/src/rasterize.ts`; create `compiler/src/carousel.ts`; modify `compiler/src/cli.ts`;
tests `compiler/__tests__/carousel.test.ts`.

**Interfaces:**
- `rasterize.ts`: `rasterizeManyToPng(svgs: string[], width: number, omitBackground?): Promise<Buffer[]>` —
  **one** `launchBrowser()`, then per svg a `newPage`/`setContent`/screenshot; close the browser once; returns
  the PNG buffers in order. (Refactor: `rasterizeToPng` and this share `launchBrowser` + the HTML-shell helper;
  extract a small `screenshotSvg(page, svg, width, omitBackground)` used by both. No behavior change to
  `rasterizeToPng`/the cover.)
- `carousel.ts`: `CarouselInput = { frames: CardInput[] }`; `compileCarousel(input: CarouselInput):
  Promise<Buffer>` — `buildCardSvg` per frame (reuse slice 1; all frames square), `rasterizeManyToPng` at the
  square width (1080), return `Buffer.from(JSON.stringify({ png_base64: buffers.map(b => b.toString("base64")) }))`.
- CLI `--format carousel`: reads `CarouselInput` JSON on stdin → `compileCarousel` → JSON on stdout; short-
  circuits before the `Book` parse (mirror the `card` branch at `cli.ts:59`); leaves epub/pdf/cover/docx/card
  intact.

**Tests (CI-safe — no real puppeteer):** the JSON-envelope shape is exercised by asserting `buildCardSvg` per
frame (the SVG contract for a couple of frames) and that `compileCarousel`'s frame loop maps N inputs → N
entries; the actual rasterize (Chromium) is not run in CI (same constraint as the card + cover tests). If
`rasterizeManyToPng` can't be unit-tested without Chromium, assert its absent-puppeteer contract (throws) like
`rasterize.test.ts` does.

## Unit B — Backend: carousel contract (`schemas` + `prompt` + `generate_carousel`)

**Files:** modify `backend/src/derivatives/{schemas.py, prompt.py, generate.py}`; tests
`backend/tests/test_derivatives_carousel.py`.

**Interfaces:**
- `schemas.py`: `CarouselRequest {source_text: str|None, topic_version_id: uuid.UUID|None, tone: str|None,
  api_key: str|None, provider_id: str="anthropic", model: str|None}` — a `model_validator` requiring EXACTLY
  ONE of source_text/topic_version_id (mirror `CardRequest`), plus the `_known_provider` field_validator; NO
  `size` (square fixed). `CarouselFrame {card: CardContent, image_png_base64: str}`; `CarouselResponse {frames:
  list[CarouselFrame], provenance: str="ai-generated"}`. Reuse `CardContent` from slice 1.
- `prompt.py build_carousel_prompt(source_text, tone) -> str` — split the source into a **4–8** frame carousel:
  frame 1 a hook/cover, the middle frames one point each, the last a CTA/source line; "PROMOTE the source,
  invent nothing beyond it"; headline ≤~50 chars, subtext ≤~140 per frame; return-only JSON
  `{"frames":[{"headline","subtext"}]}`.
- `generate.py generate_carousel(*, source_text, tone, provider_id, api_key, model) -> list[CardContent]` —
  `build_provider` + `generate_validated` (`max_repairs=_MAX_REPAIRS`, `max_tokens` ~2048); `_validate` coerces
  to a frames model and **enforces 4 ≤ len(frames) ≤ 8** (a `_CarouselOutput` with `Field(min_length=4,
  max_length=8)`); returns the frames as `CardContent`s (source_label None here — the router sets it on the
  last frame).

**Tests (mocked provider — `fake_provider`, real `generate_validated`):** happy path returns 4–8 `CardContent`
frames; fewer than 4 / more than 8 → repair-or-`LLMSchemaError`; the prompt embeds the source + the 4–8 rule +
"invent nothing"; the api_key never appears in `caplog`.

## Unit C — Backend: carousel endpoint + batch render

**Files:** modify `backend/src/derivatives/router.py`; add a batch render helper in
`backend/src/derivatives/render.py`; tests `backend/tests/test_derivatives_carousel_endpoint.py`.

**Interfaces:**
- `render.py compile_carousel_png(frames: list[dict]) -> list[bytes]` — compiler subprocess (mirror
  `compile_card_png`): argv `--format carousel`, stdin `json.dumps({"frames": frames})`, stdout parsed as
  `{"png_base64": [...]}` → decode each to bytes; timeout, `CardRenderError` on failure; never log content.
- `POST /api/v1/derivatives/carousel` → `CarouselResponse`. **Copy `make_card`'s key fork + trust-seam block
  verbatim** (managed/BYOK 400/429; `topic_version_id` → 401 signed-out / 404 missing / 403 ProjectAccessError;
  assemble `source_text` + `source_label`). Then: `generate_carousel` (off-loop `asyncio.to_thread`) → build N
  `CardInput` dicts `{headline, subtext, source_label: <label on LAST frame only, else None>, size:"square"}`
  → `compile_carousel_png` → assemble `CarouselResponse` frames (each `{card, image_png_base64}`; the last
  frame's `card.source_label` = the provenance label). `LLMSchemaError`/`CardRenderError` → 502; key/content
  never logged.

**Tests:** carousel 200 from `source_text` (mock provider, stub `compile_carousel_png` → N `b"PNG"`); both/
neither source → 422; `topic_version_id` member → 200 with the last frame carrying the source_label, non-member
→ 403, missing → 404; malformed `topic_version_id` → 422; managed 400 / over-cap 429; key not in `caplog`.

## Unit D — Mobile: carousel mode

**Files:** modify `mobile/src/api/derivativesClient.ts`, `mobile/app/(tabs)/posts.tsx`, `mobile/src/help-
content/{features.ts, topics.ts}`; create `mobile/src/hooks/useMakeCarousel.ts`; tests
`mobile/__tests__/screens/Publish.carousel.test.tsx`.

**Interfaces:**
- `derivativesClient.ts`: `MakeCarouselResponse {frames: {card:{headline,subtext,source_label:string|null},
  image_png_base64:string}[]; provenance:string}`; `makeCarousel(req: {source_text?|topic_version_id?, tone?,
  api_key?, provider_id?, model?}): Promise<MakeCarouselResponse>` → `POST /derivatives/carousel` (mirror
  `makeCard`; `IS_DEMO` blocks).
- `useMakeCarousel` — mirror `useMakeCard`'s `knownNotPro` gate.
- `posts.tsx`: extend the mode toggle to **Text post | Image card | Carousel**. Carousel mode: source (paste
  text OR the slice-1 validated-section picker) + tone + "Make carousel" → a **horizontal pager** (`FlatList`
  horizontal / paged `ScrollView`) of the N frames (each `<Image>` at `data:image/png;base64,…`, square aspect)
  + per-frame headline/subtext + a **"Download all"** button (loop `downloadArtifact(fromBase64(f.image_png_
  base64), \`frame-${i+1}.png\`, "image/png")`) and optional download-each. Do NOT regress the text-post/card
  modes.
- **Help DoD:** update/extend the `publish-card` topic (or add a `publish-carousel` `FEATURES` key + topic) so
  the coverage gate passes with the new capability described.

**Tests:** carousel mode renders N frame images + N copies + "Download all" (asserts N `downloadArtifact` calls
with the `image/png` mime); "Make carousel" from text calls `makeCarousel` with `{source_text}`; from a section
calls it with `{topic_version_id}`; known-not-Pro without a key blocks.

---

## Cross-cutting / global constraints

- **BYOK/ADR-001:** the carousel LLM call obeys the derivatives discipline — key never logged/persisted;
  source text + section content + frame copy never logged; key resolved via managed vault or the BYOK body.
- **Access:** a `topic_version_id` carousel is gated by `require_project_access` (owner/reviewer/editor); flat
  `source_text` needs no trust access.
- **Gating:** Pro/managed-or-BYOK, paid app only; `IS_DEMO` blocks the call. Render is free (Chromium) — the
  only billable step is the LLM copy.
- **No migration.** asyncpg; no key/content in logs; 70% coverage. Backend CI runs BOTH `ruff check` and
  `ruff format --check` — run `ruff format backend/` before committing. No `backend/__init__.py`, no
  conftest/test_dbsafety edits. Mobile: `useThemedStyles`; no color-literal test asserts; `tsc`/`jest`/`eslint`
  green. Compiler jest green.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Decomposition (SDD)

- **T1 — Compiler batch renderer (Unit A):** `rasterizeManyToPng` (one browser, N shots) + `compileCarousel`
  (JSON envelope of N base64 PNGs) + `--format carousel` CLI. Reuses `buildCardSvg`. Tests.
- **T2 — Backend carousel contract (Unit B):** `CarouselRequest`/`CarouselFrame`/`CarouselResponse` +
  `build_carousel_prompt` + `generate_carousel` (4–8 enforced). Mocked-provider tests.
- **T3 — Backend carousel endpoint + render (Unit C):** `compile_carousel_png` + `POST /derivatives/carousel`
  (key fork + trust seam copied from make_card; provenance on the last frame). Endpoint tests.
- **T4 — Mobile carousel mode (Unit D):** `makeCarousel` + `useMakeCarousel` + the Publish carousel pager +
  Download-all + Help. Tests.

(T1 gates T3's render; T2 gates T3's generate; T3 gates T4. T1/T2 independent.)

## Rollout

Backend refresh (new endpoint + the compiler's `--format carousel` in the api image; Chromium already present)
+ web deploy + APK. No migration.

## Out of scope / follow-ups

- Non-square carousel aspects (4:5, per-platform); animated/audio/A-V frames; per-frame reorder/edit; a PDF
  bundle export; a "my validated versions" endpoint (the picker N+1 from slice 1); extracting the render engine
  to a `wegofwd-*` package.

## Open (non-blocking)

- The exact 4–8 bound may want tuning after real use (readability vs completeness); enforced in the schema so
  it's a one-line change.
- `rasterizeManyToPng` opens N pages in one browser sequentially — fine for 4–8 frames; a concurrency cap is a
  future perf option if frame counts ever grow.
