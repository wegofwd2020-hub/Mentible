# P1-5 slice 2 — Publish carousel derivative — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an owned source into an N-frame (4–8) branded PNG carousel, batch-rendered in one Chromium process, downloadable frame-by-frame or all-at-once — surfaced as a third mode on the Publish tab beside text posts and single image cards.

**Architecture:** A new compiler `--format carousel` renders N `buildCardSvg` frames through a single headless-Chromium browser (`rasterizeManyToPng`) and emits a JSON envelope of N base64 PNGs. A new backend `POST /api/v1/derivatives/carousel` copies the shipped `/derivatives/card` key-fork + trust-seam verbatim, generates the N-frame copy through the `wegofwd_llm` seam, and shells to the batch renderer. Mobile adds a carousel mode (source picker reused from the card slice) with a frame pager + "Download all".

**Tech Stack:** Node/TypeScript compiler (jest, headless-Chromium), FastAPI + asyncpg + `wegofwd_llm` (pytest), React Native + Expo (jest + RNTL).

**Spec:** `docs/superpowers/specs/2026-08-17-publish-carousel-derivative-design.md`

## Global Constraints

- **Heavy reuse of slice 1** (the shipped image card): `compiler/src/card.ts buildCardSvg`/`CardInput`; the `/derivatives/card` key-fork + trust-seam (`router.py make_card`); `render.py compile_card_png`; `useMakeCard`; the Publish card mode + validated-section picker. Copy these patterns; do not re-derive them.
- **N is LLM-decided, bounded 4 ≤ N ≤ 8** (enforced in the schema). Frames are **square 1080²** only.
- **Provenance label ("Based on N cited source(s)") goes on the LAST frame only** for a validated-section carousel; None otherwise, and the model's per-frame `source_label` is ignored.
- **BYOK/ADR-001:** key never logged/persisted; source text + section content + frame copy never logged; key resolved via managed vault or the BYOK body.
- **Access:** a `topic_version_id` carousel is gated by `require_project_access` (owner/reviewer/editor); flat `source_text` needs no trust access. `IS_DEMO` blocks the call.
- **No migration.** asyncpg; no key/content in logs; 70% coverage. Backend CI runs BOTH `ruff check` and `ruff format --check` — run `ruff format backend/` before committing. **Never** create `backend/__init__.py` or touch `conftest.py`/`test_dbsafety.py`; run backend tests with `.venv/bin/python -m pytest` and `PYTHONPATH=<repo-root>`.
- Mobile: `useThemedStyles`; no color-literal test asserts; `npx tsc --noEmit` + `npx jest` + `npx eslint .` green. **Help DoD:** update the `publish-card` topic (or add `publish-carousel`) so `help/coverage.test.ts` passes.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Canonical shapes (every task uses these exact names)

```
CarouselInput   = { frames: CardInput[] }                                   # compiler stdin (CardInput from slice 1: {headline,subtext,source_label?,size})
carousel JSON   = { png_base64: string[] }                                  # compiler stdout
CardContent     = { headline, subtext, source_label: str|None }             # reused from slice 1
CarouselFrame   = { card: CardContent, image_png_base64: str }
CarouselResponse= { frames: CarouselFrame[], provenance: "ai-generated" }
CarouselRequest = { source_text?|topic_version_id? (exactly one), tone?, api_key?, provider_id="anthropic", model? }   # NO size (square fixed)
```

---

## Task 1: Compiler batch renderer (`rasterizeManyToPng` + `compileCarousel` + `--format carousel`)

**Files:** Modify `compiler/src/rasterize.ts`; Create `compiler/src/carousel.ts`; Modify `compiler/src/cli.ts`; Test `compiler/__tests__/carousel.test.ts`.

**Interfaces:**
- Consumes: `buildCardSvg`, `CardInput` from `compiler/src/card.ts`; `launchBrowser` (module-private in `rasterize.ts`).
- Produces: `rasterizeManyToPng(svgs: string[], width: number, omitBackground?: boolean): Promise<Buffer[]>`; `CarouselInput` type; `compileCarousel(input: CarouselInput): Promise<Buffer>` (a JSON buffer `{png_base64: string[]}`); CLI `--format carousel`.

- [ ] **Step 1: Write the failing test** (CI-safe — assert the SVG-per-frame contract + absent-puppeteer contract, no real Chromium)

```ts
// compiler/__tests__/carousel.test.ts
import { rasterizeManyToPng } from "../src/rasterize";
import { buildCardSvg } from "../src/card";

it("rasterizeManyToPng throws the puppeteer-absent contract (CI-safe)", async () => {
  await expect(rasterizeManyToPng(["<svg/>"], 1080)).rejects.toThrow(/puppeteer/i);
});

it("each carousel frame's SVG carries its own copy at the square viewBox", () => {
  const frames = [
    { headline: "Hook", subtext: "Open strong.", size: "square" as const },
    { headline: "Point one", subtext: "A claim.", size: "square" as const },
  ];
  for (const f of frames) {
    const svg = buildCardSvg(f);
    expect(svg).toContain('viewBox="0 0 1080 1080"');
    expect(svg).toContain(f.headline);
    expect(svg).toContain(f.subtext);
  }
});
```

- [ ] **Step 2: Run — expect FAIL** (`cd compiler && npx jest carousel` — `rasterizeManyToPng` undefined)

- [ ] **Step 3: Add `rasterizeManyToPng` to `rasterize.ts`**

Refactor the existing single-shot body into a shared helper and add the batch version (one browser, N pages). The existing `rasterizeToPng` keeps its exact behavior.

```ts
// rasterize.ts — extract the HTML shell + screenshot into a helper, reuse in both:
function shellHtml(inner: string, width: number): string {
  return (
    `<!DOCTYPE html><html><body style="margin:0">` +
    `<div id="target" style="display:inline-block;max-width:${width}px">` +
    `<style>#target svg{max-width:${width}px;height:auto;display:block}</style>${inner}</div>` +
    `</body></html>`
  );
}

async function shotSvg(page: PuppeteerPage, svg: string, width: number, omitBackground: boolean): Promise<Buffer> {
  await page.setViewport({ width, height: 2000, deviceScaleFactor: 2 });
  await page.setContent(shellHtml(svg, width));
  const el = await page.$("#target");
  const buf = el ? await el.screenshot({ type: "png", omitBackground }) : await page.screenshot({ type: "png", omitBackground });
  return Buffer.from(buf);
}

// Batch: ONE browser, N screenshots. Order preserved.
export async function rasterizeManyToPng(svgs: string[], width: number, omitBackground = false): Promise<Buffer[]> {
  const browser = await launchBrowser();
  try {
    const out: Buffer[] = [];
    for (const svg of svgs) {
      const page = await browser.newPage();
      out.push(await shotSvg(page, svg, width, omitBackground));
      await page.close();
    }
    return out;
  } finally {
    await browser.close();
  }
}
```

Refactor `rasterizeToPng` to reuse `shotSvg` (launch → newPage → `shotSvg(page, input.svg ?? input.html ?? "", width, omitBackground)` → close browser). Keep its exported signature and behavior identical (the cover test must still pass). If the `PuppeteerPage` type isn't already exported/shared, reuse the interface already declared in `rasterize.ts`.

- [ ] **Step 4: Implement `carousel.ts`**

```ts
// compiler/src/carousel.ts
import { buildCardSvg, type CardInput } from "./card";
import { rasterizeManyToPng } from "./rasterize";

export interface CarouselInput {
  frames: CardInput[];
}

const SQUARE = 1080;

// Render every frame's branded SVG to a PNG in one Chromium pass, and emit a
// JSON envelope of base64 PNGs (the CLI stream carries one blob; this is how N
// images ride it).
export async function compileCarousel(input: CarouselInput): Promise<Buffer> {
  const svgs = input.frames.map((f) => buildCardSvg({ ...f, size: "square" }));
  const pngs = await rasterizeManyToPng(svgs, SQUARE);
  return Buffer.from(JSON.stringify({ png_base64: pngs.map((b) => b.toString("base64")) }));
}
```

- [ ] **Step 5: Dispatch `--format carousel` in `cli.ts`** (mirror the `card` short-circuit at cli.ts:59)

```ts
// cli.ts — import
import { compileCarousel, type CarouselInput } from "./carousel";
// Format union
type Format = "epub" | "pdf" | "cover" | "docx" | "card" | "carousel";
// parseArgs --format arm: add `f === "carousel" ? "carousel" :`
// in main(), beside the `if (format === "card")` short-circuit, BEFORE the Book parse:
if (format === "carousel") {
  const out = await compileCarousel(JSON.parse(raw) as CarouselInput);
  process.stdout.write(out);
  return;
}
```

- [ ] **Step 6: Run — expect PASS** (`cd compiler && npx jest carousel card cover && npx tsc --noEmit`, then full `npx jest`).

- [ ] **Step 7: Commit**

```bash
git add compiler/src/rasterize.ts compiler/src/carousel.ts compiler/src/cli.ts compiler/__tests__/carousel.test.ts
git commit -m "feat(compiler): batch carousel renderer (rasterizeManyToPng, --format carousel)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend carousel contract (`schemas` + `prompt` + `generate_carousel`)

**Files:** Modify `backend/src/derivatives/{schemas.py, prompt.py, generate.py}`; Test `backend/tests/test_derivatives_carousel.py`.

**Interfaces:**
- Consumes: the `wegofwd_llm` seam `generate_card` uses (`build_provider`, `generate_validated`, `LLMRequest`, `parse_json_response`, module `_MAX_REPAIRS`); `CardContent` from `schemas.py`.
- Produces: `CarouselRequest`, `CarouselFrame`, `CarouselResponse` (schemas); `build_carousel_prompt(source_text, tone) -> str`; `generate_carousel(*, source_text, tone, provider_id, api_key, model) -> list[CardContent]`.

- [ ] **Step 1: Write the failing tests** (mocked via `fake_provider`, real `generate_validated`)

```python
# backend/tests/test_derivatives_carousel.py
import uuid, pytest
from pydantic import ValidationError
from unittest.mock import patch
from backend.src.derivatives import generate as gen
from backend.src.derivatives.schemas import CarouselRequest
from backend.tests.helpers import fake_provider   # same helper generate tests use

_VID = uuid.uuid4()

def test_carousel_request_requires_exactly_one_source():
    CarouselRequest(source_text="x")
    CarouselRequest(topic_version_id=_VID)
    with pytest.raises(ValidationError): CarouselRequest()
    with pytest.raises(ValidationError): CarouselRequest(source_text="x", topic_version_id=_VID)

def test_carousel_request_rejects_unknown_provider():
    with pytest.raises(ValidationError):
        CarouselRequest(source_text="x", provider_id="nope")

def test_generate_carousel_returns_four_to_eight_frames(caplog):
    frames = [{"headline": f"H{i}", "subtext": f"S{i}"} for i in range(5)]
    good = '{"frames": ' + __import__("json").dumps(frames) + '}'
    with patch("backend.src.derivatives.generate.build_provider", return_value=fake_provider(responses=[good])):
        out = gen.generate_carousel(source_text="src", tone=None, provider_id="anthropic", api_key="sk-ant-xxxxxxxxxxxxxxxxxxxx", model="m")
    assert 4 <= len(out) <= 8 and out[0].headline == "H0"
    assert "sk-ant-xxxxxxxxxxxxxxxxxxxx" not in caplog.text

def test_generate_carousel_rejects_too_few_frames():
    bad = '{"frames": [{"headline":"H","subtext":"S"}]}'   # 1 frame < 4
    with patch("backend.src.derivatives.generate.build_provider", return_value=fake_provider(responses=[bad, bad, bad])):
        with pytest.raises(Exception):   # LLMSchemaError after repairs
            gen.generate_carousel(source_text="src", tone=None, provider_id="anthropic", api_key="k", model="m")
```

- [ ] **Step 2: Run — expect FAIL** (`cd backend && .venv/bin/python -m pytest tests/test_derivatives_carousel.py -v`)

- [ ] **Step 3: Implement schemas** (`schemas.py` — beside `CardRequest`; mirror its validators)

```python
class CarouselRequest(BaseModel):
    source_text: str | None = Field(default=None, min_length=1, max_length=20000)
    topic_version_id: uuid.UUID | None = None
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
    def _exactly_one_source(self) -> "CarouselRequest":
        if bool(self.source_text) == bool(self.topic_version_id):
            raise ValueError("provide exactly one of source_text or topic_version_id")
        return self

class CarouselFrame(BaseModel):
    card: CardContent
    image_png_base64: str

class CarouselResponse(BaseModel):
    frames: list[CarouselFrame]
    provenance: str = "ai-generated"
```

- [ ] **Step 4: Implement the prompt** (`prompt.py`)

```python
def build_carousel_prompt(source_text: str, tone: str | None) -> str:
    tone_line = f"Tone: {tone}.\n" if tone else ""
    return (
        "You write a short-form social CAROUSEL that PROMOTES the source below. Invent nothing beyond it.\n"
        f"{tone_line}"
        "Split the source into 4 to 8 ordered frames: frame 1 is a hook/cover, the middle frames make one "
        "point each, and the last frame is a call-to-action.\n"
        "Each frame: headline <= 50 characters (a punch), subtext <= 140 characters.\n"
        'Return ONLY JSON: {"frames":[{"headline": string, "subtext": string}]} with between 4 and 8 frames.\n\n'
        f"SOURCE:\n\"\"\"\n{source_text}\n\"\"\""
    )
```

- [ ] **Step 5: Implement `generate_carousel`** (`generate.py` — enforce 4–8 in the validated model)

```python
from pydantic import BaseModel as _BM, Field as _F
from backend.src.derivatives.prompt import build_carousel_prompt
from backend.src.derivatives.schemas import CardContent

class _CarouselFrame(_BM):
    headline: str
    subtext: str

class _CarouselOutput(_BM):
    frames: list[_CarouselFrame] = _F(min_length=4, max_length=8)

_CAROUSEL_MAX_TOKENS = 2048

def generate_carousel(*, source_text: str, tone: str | None, provider_id: str, api_key: str, model: str) -> list[CardContent]:
    """Generate 4-8 carousel frame copies. Never logs api_key. LLMSchemaError on
    repair-budget exhaustion (router maps to 502)."""
    prompt = build_carousel_prompt(source_text, tone)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_CAROUSEL_MAX_TOKENS, response_format="json")

    def _validate(text: str) -> _CarouselOutput:
        return _CarouselOutput.model_validate(parse_json_response(text))

    out = generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS).parsed
    return [CardContent(headline=f.headline, subtext=f.subtext, source_label=None) for f in out.frames]
```

- [ ] **Step 6: Run — expect PASS**; **Step 7: `ruff format backend/ && ruff check backend/`**; **Step 8: Commit**

```bash
git add backend/src/derivatives/schemas.py backend/src/derivatives/prompt.py backend/src/derivatives/generate.py backend/tests/test_derivatives_carousel.py
git commit -m "feat(derivatives): carousel contract (4-8 frames) — schemas + prompt + generate_carousel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Backend carousel endpoint + batch render

**Files:** Modify `backend/src/derivatives/render.py`, `backend/src/derivatives/router.py`; Test `backend/tests/test_derivatives_carousel_endpoint.py`.

**Interfaces:**
- Consumes: `generate_carousel` (T2); `CarouselRequest`/`CarouselResponse`/`CarouselFrame`/`CardContent`; the compiler `--format carousel` (T1); `make_card`'s key-fork + trust-seam (copy verbatim).
- Produces: `render.compile_carousel_png(frames: list[dict]) -> list[bytes]`; `POST /api/v1/derivatives/carousel`.

- [ ] **Step 1: `compile_carousel_png` in `render.py`** (mirror `compile_card_png`)

```python
async def compile_carousel_png(frames: list[dict]) -> list[bytes]:
    """Compile a list of CardInput dicts into PNG bytes (one per frame) via the
    Node compiler's `--format carousel` mode. Raises CardRenderError on failure.
    The compiler emits {"png_base64": [...]} on stdout."""
    import base64 as _b64
    argv = [settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", "carousel"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise CardRenderError("compiler runtime unavailable") from exc
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=json.dumps({"frames": frames}).encode()),
            timeout=settings.export_timeout_seconds,
        )
    except TimeoutError as exc:
        proc.kill(); await proc.wait()
        raise CardRenderError("carousel render timed out") from exc
    if proc.returncode != 0:
        log.error("carousel_render_failed", returncode=proc.returncode, stderr_len=len(stderr))
        raise CardRenderError("carousel render failed")
    try:
        payload = json.loads(stdout)
        return [_b64.b64decode(s) for s in payload["png_base64"]]
    except (ValueError, KeyError, TypeError) as exc:
        log.error("carousel_render_bad_output")
        raise CardRenderError("carousel render produced bad output") from exc
```

- [ ] **Step 2: Write the failing endpoint test** (mirror `test_derivatives_card_endpoint.py`)

```python
# backend/tests/test_derivatives_carousel_endpoint.py  (adapt the card-endpoint harness)
# - POST /api/v1/derivatives/carousel with source_text + BYOK key, provider mocked (fake_provider
#   returning 5 frames) + compile_carousel_png stubbed → [b"PNG1".. b"PNG5"] → 200, body.frames has 5,
#   each image_png_base64 == base64 of the stub; key not in caplog.
# - both source & topic_version_id → 422; neither → 422.
# - topic_version_id member → 200 and ONLY the LAST frame's card.source_label == "Based on N cited source(s)";
#   non-member → 403; missing → 404; malformed topic_version_id → 422.
# - managed-ineligible → 400; over-cap → 429.
```

- [ ] **Step 3: Run — expect FAIL** (endpoint 404); **Step 4: Implement the endpoint** (`router.py`)

Copy `make_card`'s key-fork + trust-seam block VERBATIM (managed/BYOK 400/429; `topic_version_id` → 401/404/403 via `require_project_access`/`ProjectAccessError`; assemble `source_text` + `source_label`). Then the carousel-specific tail:

```python
@router.post("/carousel", response_model=CarouselResponse, dependencies=[Depends(enforce_rate_limit)])
async def make_carousel(body: CarouselRequest, request: Request,
                        principal: Principal | None = Depends(optional_user)) -> CarouselResponse:
    # --- key fork + trust seam: COPY from make_card (managed/BYOK → api_key, model;
    #     topic_version_id → source_text + source_label; flat text → source_label None) ---
    # ... (identical block) ...
    # --- generate + batch render ---
    try:
        frames = await asyncio.to_thread(
            generate_carousel, source_text=source_text, tone=body.tone,
            provider_id=body.provider_id, api_key=api_key, model=model)
    except LLMSchemaError:
        log.warning("carousel_validation_failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not generate the carousel") from None
    # (keep the LLMAuthError/RateLimit/Error arms parallel to make_card)
    n = len(frames)
    card_inputs = [
        {"headline": f.headline, "subtext": f.subtext,
         "source_label": (source_label if (body.topic_version_id is not None and i == n - 1) else None),
         "size": "square"}
        for i, f in enumerate(frames)
    ]
    try:
        pngs = await compile_carousel_png(card_inputs)
    except CardRenderError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not render the carousel") from None
    out_frames = [
        CarouselFrame(card=CardContent(headline=ci["headline"], subtext=ci["subtext"], source_label=ci["source_label"]),
                      image_png_base64=base64.b64encode(png).decode())
        for ci, png in zip(card_inputs, pngs)
    ]
    return CarouselResponse(frames=out_frames, provenance="ai-generated")
```

Add imports: `from backend.src.derivatives.generate import generate_carousel`, `from backend.src.derivatives.schemas import CarouselRequest, CarouselResponse, CarouselFrame`, `from backend.src.derivatives.render import compile_carousel_png` (CardRenderError already imported for the card endpoint). `base64`, `CardContent`, `topic_repo`, `require_project_access`, `ProjectAccessError` are already imported by the card endpoint.

- [ ] **Step 5: Run — expect PASS**; **Step 6: `ruff format backend/ && ruff check backend/`** + confirm no-key-in-logs (`.venv/bin/python -m pytest tests/ -k "log or redact" -q`); **Step 7: Commit**

```bash
git add backend/src/derivatives/render.py backend/src/derivatives/router.py backend/tests/test_derivatives_carousel_endpoint.py
git commit -m "feat(derivatives): /carousel endpoint — batch render + last-frame provenance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Mobile carousel mode

**Files:** Modify `mobile/src/api/derivativesClient.ts`, `mobile/app/(tabs)/posts.tsx`, `mobile/src/help-content/{features.ts, topics.ts}`; Create `mobile/src/hooks/useMakeCarousel.ts`; Test `mobile/__tests__/screens/Publish.carousel.test.tsx`.

**Interfaces:**
- Consumes: `POST /api/v1/derivatives/carousel` (T3); `downloadArtifact` from `@/storage/epubLibrary`, `fromBase64` from `@/storage/pickBookFile`; the slice-1 validated-section picker (`fetchValidatedSections`, `cardSource`/`selectedSectionId` state in posts.tsx).
- Produces: `makeCarousel`, `MakeCarouselResponse`; `useMakeCarousel`; the Publish carousel mode.

- [ ] **Step 1: Client call** (`derivativesClient.ts` — mirror `makeCard`)

```ts
export interface MakeCarouselResponse {
  frames: { card: { headline: string; subtext: string; source_label: string | null }; image_png_base64: string }[];
  provenance: string;
}
export async function makeCarousel(req: {
  source_text?: string; topic_version_id?: string; tone?: string; api_key?: string; provider_id?: string; model?: string;
}): Promise<MakeCarouselResponse> {
  if (IS_DEMO) throw new Error("Making a carousel is disabled in this demo build.");
  const res = await fetch(`${resolveBaseUrl()}/api/v1/derivatives/carousel`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req),
  });
  if (!res.ok) { const b = await res.text().catch(() => ""); throw new ApiError(res.status, b); }
  return res.json() as Promise<MakeCarouselResponse>;
}
```

- [ ] **Step 2: `useMakeCarousel`** — copy `useMakeCard.ts` structure verbatim, swapping `makeCard`→`makeCarousel`, `MakeCardResponse`→`MakeCarouselResponse`, and dropping `size` from `RunArgs` (`{ source_text?, topic_version_id?, tone? }`).

- [ ] **Step 3: Write the failing test**

```tsx
// mobile/__tests__/screens/Publish.carousel.test.tsx  (mirror Publish.card.test.tsx's mocks)
// - switch to Carousel mode → the source field renders; "Make carousel" with source text calls makeCarousel with { source_text }
// - a 3-frame MakeCarouselResponse renders 3 <Image>s (data: URIs) + 3 copies + a "Download all" button
// - pressing "Download all" calls downloadArtifact 3 times with "image/png"
// - picking a validated section calls makeCarousel with { topic_version_id }
// - known-not-Pro without a key blocks with the add-key message
```

- [ ] **Step 4: Carousel mode in `posts.tsx`** — widen `mode` to `"post" | "card" | "carousel"` (extend the mode toggle list). Add `useMakeCarousel` (getApiKey `loadApiKey("anthropic")`) + a `carouselResult`. Carousel mode reuses the SAME source switch (text | validated-section picker) as card mode — factor the shared source UI or duplicate the small block. On result, render a **horizontal pager** (`FlatList horizontal pagingEnabled` or a paged `ScrollView`) of `carouselResult.frames`, each `<Image source={{ uri: \`data:image/png;base64,${f.image_png_base64}\` }} style={{ aspectRatio: 1, width: "100%" }} resizeMode="contain" />` with the frame's headline/subtext beneath, plus a **"Download all"** button:

```ts
const onDownloadAll = useCallback(async () => {
  if (!carouselResult) return;
  for (let i = 0; i < carouselResult.frames.length; i++) {
    await downloadArtifact(fromBase64(carouselResult.frames[i].image_png_base64), `frame-${i + 1}.png`, "image/png");
  }
}, [carouselResult]);
```

Do NOT regress the text-post or card modes (they stay as their own `mode` branches).

- [ ] **Step 5: Help DoD** — extend the `publish-card` Help topic copy (and/or add a `publish-carousel` `FEATURES` key + topic) to describe the carousel capability (4–8 frames from your own content, download all). Keep `help/coverage.test.ts` green.

- [ ] **Step 6: Run the gates** (`cd mobile && npx tsc --noEmit && npx jest && npx eslint .` — all green incl. help/coverage + the new test); **Step 7: Commit**

```bash
git add mobile/src/api/derivativesClient.ts mobile/src/hooks/useMakeCarousel.ts "mobile/app/(tabs)/posts.tsx" mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/__tests__/screens/Publish.carousel.test.tsx
git commit -m "feat(publish): carousel mode — N-frame pager + Download all (P1-5 slice 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Unit A→T1 (rasterizeManyToPng + compileCarousel + `--format carousel`); Unit B→T2 (schemas/prompt/generate_carousel with 4–8); Unit C→T3 (compile_carousel_png + endpoint, key fork + seam + last-frame provenance); Unit D→T4 (client/hook/carousel mode/pager/Download-all/Help). All covered. Deferred items (non-square aspects, animated/audio, per-frame edit, PDF bundle, wegofwd extraction) are out of scope in spec + plan.

**Placeholder scan:** T3's endpoint reuses `make_card`'s key-fork + trust-seam "verbatim" (named source + exact anchors) rather than reproducing ~50 lines already reviewed in slice 1; every new piece (batch render helper, generate/render/assemble tail, last-frame provenance) is given in full. Every other step has concrete code.

**Type consistency:** `CarouselInput{frames: CardInput[]}` (compiler stdin) matches the `{frames: card_inputs}` the backend writes; `CardContent{headline,subtext,source_label}` reused from slice 1 across T2/T3/mobile; `CarouselFrame{card,image_png_base64}` + `CarouselResponse{frames,provenance}` identical in backend schemas, the endpoint return, and mobile `MakeCarouselResponse`. Square 1080 is the single width in compiler `SQUARE`, the `size:"square"` on every card_input, and the mobile `aspectRatio:1`. The 4–8 bound lives in one place (`_CarouselOutput.frames min_length/max_length`). Last-frame provenance is applied once (T3, `i == n-1`).

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-08-17-publish-carousel-derivative.md`. Order T1→T2→T3→T4 (T1 gates T3's render; T2 gates T3's generate; T3 gates T4; T1/T2 independent).
