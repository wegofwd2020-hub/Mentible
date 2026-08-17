# P1-5 slice 1 — Publish image/quote card derivative — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an owned source (pasted text or a validated topic-version section) into a downloadable branded image/quote card, surfaced on an unhidden "Publish" tab alongside the already-shipping text-post derivative.

**Architecture:** A new compiler `card` format (`compileCard` — a branded SVG forked from `buildCoverSvg`, rasterized via the existing `rasterizeToPng`) rendered synchronously by a new backend `POST /api/v1/derivatives/card`, which reuses the derivatives module's managed/BYOK key fork, generates the card copy through the `wegofwd_llm` seam, and (when given a `topic_version_id`) pulls the source from a validated trust section carrying its `source_ids` as provenance. Mobile adds a card mode to the existing derivatives screen and unhides it as "Publish".

**Tech Stack:** Node/TypeScript compiler (jest, headless-Chromium rasterizer), FastAPI + asyncpg + `wegofwd_llm` (pytest), React Native + Expo (jest + RNTL).

**Spec:** `docs/superpowers/specs/2026-08-17-publish-image-card-derivative-design.md`

## Global Constraints

- **BYOK/ADR-001:** the card LLM call obeys the derivatives discipline — key never logged/persisted (resolved via managed vault or the BYOK body); source text + section content never logged.
- **Access:** a `topic_version_id` card is gated by `trust/access.require_project_access` (owner/reviewer/editor); flat `source_text` needs no trust access (caller's own text).
- **Gating:** Pro/managed-or-BYOK, paid app only; `IS_DEMO` blocks the call and hides the tab.
- **No migration, no new table.** Card render is free (Chromium) — no new metered cost.
- Backend tests import `from backend.src...` via CI `PYTHONPATH=<repo-root>` — **never create `backend/__init__.py` or touch `conftest.py`/`test_dbsafety.py`.** Run backend tests with `.venv/bin/python -m pytest`.
- **Backend CI runs BOTH `ruff check` and `ruff format --check`** — run `ruff format backend/` before committing (a recurring red-at-merge trap).
- Mobile: `useThemedStyles`; no color-literal test asserts; `npx tsc --noEmit` + full `npx jest` + `npx eslint .` green.
- **Definition of Done (Help gate):** the card feature needs a `FEATURES` key + a Help topic in T4, or `mobile/__tests__/help/coverage.test.ts` fails.
- Card sizes (exact): `square` 1080×1080, `linkedin` 1200×627, `story` 1080×1920. Report/field names exact (below). Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Canonical shapes (every task uses these exact names)

```
CardInput   = { headline: string, subtext: string, source_label?: string, size: "square"|"linkedin"|"story" }   # compiler stdin + backend render input
CardContent = { headline: string, subtext: string, source_label: string | null }                                 # LLM contract (source_label nullable)
CardResponse= { card: CardContent, size: "square"|"linkedin"|"story", image_png_base64: string, provenance: "ai-generated" }
```

---

## Task 1: Compiler card renderer (`compiler/src/card.ts` + `--format card`)

**Files:** Create `compiler/src/card.ts`; Modify `compiler/src/cli.ts`; Test `compiler/__tests__/card.test.ts`.

**Interfaces:**
- Consumes: `rasterizeToPng` from `compiler/src/rasterize.ts`; `STUDIO` from `compiler/src/tokens.ts`.
- Produces: `CardInput` type; `buildCardSvg(input: CardInput): string`; `compileCard(input: CardInput): Promise<Buffer>`; CLI `--format card`.

- [ ] **Step 1: Write the failing test** (SVG-contract, CI-safe — no real puppeteer)

```ts
// compiler/__tests__/card.test.ts
import { buildCardSvg, type CardInput } from "../src/card";

const base: Omit<CardInput, "size"> = { headline: "Trust is the product", subtext: "Every claim traces to a source.", source_label: "Based on 3 cited sources" };

it("renders each size with the right viewBox and the card text", () => {
  const dims = { square: [1080, 1080], linkedin: [1200, 627], story: [1080, 1920] } as const;
  for (const size of ["square", "linkedin", "story"] as const) {
    const svg = buildCardSvg({ ...base, size });
    expect(svg).toContain(`viewBox="0 0 ${dims[size][0]} ${dims[size][1]}"`);
    expect(svg).toContain("Trust is the product");
    expect(svg).toContain("Every claim traces to a source.");
    expect(svg).toContain("Based on 3 cited sources");
  }
});

it("omits the source label line when absent", () => {
  const svg = buildCardSvg({ headline: "H", subtext: "S", size: "square" });
  expect(svg).toContain("H");
  expect(svg).not.toContain("Based on");
});

it("escapes XML-special characters in the text", () => {
  const svg = buildCardSvg({ headline: "A & B <x>", subtext: "S", size: "square" });
  expect(svg).toContain("A &amp; B &lt;x&gt;");
});
```

- [ ] **Step 2: Run — expect FAIL** (`cd compiler && npx jest card` → module not found)

- [ ] **Step 3: Implement `card.ts`**

```ts
// compiler/src/card.ts
// A branded quote/summary card (headline + subtext + optional source label +
// brand mark) rendered to PNG for the Publish surface (P1-5). The SVG forks the
// cover's branded look (STUDIO palette, tokens.ts); the rasterizer is the same
// headless-Chromium path the cover uses.
import { STUDIO } from "./tokens";
import { rasterizeToPng } from "./rasterize";

export interface CardInput {
  headline: string;
  subtext: string;
  source_label?: string;
  size: "square" | "linkedin" | "story";
}

const SIZES: Record<CardInput["size"], { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  linkedin: { w: 1200, h: 627 },
  story: { w: 1080, h: 1920 },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Greedy word-wrap to at most `maxChars` per line (a deterministic heuristic —
// good enough for a fixed card; no font-metric measurement needed).
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

export function buildCardSvg(input: CardInput): string {
  const { w, h } = SIZES[input.size];
  const pad = Math.round(w * 0.08);
  const portrait = input.size === "story";
  const headSize = portrait ? 84 : Math.round(w * 0.06);
  const subSize = Math.round(headSize * 0.5);
  const headLines = wrap(input.headline, portrait ? 20 : 26, 4);
  const subLines = wrap(input.subtext, portrait ? 30 : 48, 4);

  let y = portrait ? Math.round(h * 0.32) : Math.round(h * 0.30);
  const headLH = Math.round(headSize * 1.14);
  const subLH = Math.round(subSize * 1.3);

  const head = headLines
    .map((l, i) => `<text x="${pad}" y="${y + i * headLH}" font-family="Georgia, 'Times New Roman', serif" font-size="${headSize}" font-weight="700" fill="${STUDIO.goldBright}">${esc(l)}</text>`)
    .join("");
  y += headLines.length * headLH + Math.round(headSize * 0.6);
  const sub = subLines
    .map((l, i) => `<text x="${pad}" y="${y + i * subLH}" font-family="Helvetica, Arial, sans-serif" font-size="${subSize}" fill="${STUDIO.navySoft}">${esc(l)}</text>`)
    .join("");
  y += subLines.length * subLH;

  const label = input.source_label
    ? `<text x="${pad}" y="${h - pad - 44}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(subSize * 0.7)}" fill="${STUDIO.goldSoft}">${esc(input.source_label)}</text>`
    : "";
  const brand = `<text x="${pad}" y="${h - pad}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(subSize * 0.72)}" font-weight="700" fill="${STUDIO.navySoft}">Mentible</text>`;
  const accent = `<rect x="${pad}" y="${Math.round((portrait ? h * 0.32 : h * 0.30) - headSize - 40)}" width="${Math.round(w * 0.18)}" height="8" fill="${STUDIO.goldBright}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${STUDIO.navy}"/>` +
    `<rect width="${w}" height="${h}" fill="${STUDIO.navySurface}" opacity="0.5"/>` +
    accent + head + sub + label + brand +
    `</svg>`
  );
}

export async function compileCard(input: CardInput): Promise<Buffer> {
  return rasterizeToPng({ svg: buildCardSvg(input), width: SIZES[input.size].w });
}
```

- [ ] **Step 4: Dispatch `--format card` in `cli.ts`**

The CLI currently parses stdin as a `Book` and dispatches on `format`. `card` needs to parse stdin as a `CardInput` instead. Add `"card"` to the `Format` union + the `--format` parse arm, import `compileCard`, and branch BEFORE the book parse:

```ts
// cli.ts — import
import { compileCard, type CardInput } from "./card";
// Format union
type Format = "epub" | "pdf" | "cover" | "docx" | "card";
// parseArgs --format arm — add: f === "card" ? "card" :
// in main(), after reading `raw` from stdin and BEFORE `const book = JSON.parse(raw) as Book`:
if (format === "card") {
  const out = await compileCard(JSON.parse(raw) as CardInput);
  process.stdout.write(Buffer.from(out));
  return;
}
```

(Place the `card` short-circuit so it doesn't fall through to the book-parse/dispatch chain. Keep the existing epub/pdf/cover/docx dispatch untouched for every other format.)

- [ ] **Step 5: Run — expect PASS** (`cd compiler && npx jest card && npx tsc --noEmit`, then full `npx jest`).

- [ ] **Step 6: Commit**

```bash
git add compiler/src/card.ts compiler/src/cli.ts compiler/__tests__/card.test.ts
git commit -m "feat(compiler): branded image/quote card format (compileCard, --format card)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend card contract (`schemas` + `prompt` + `generate_card`)

**Files:** Modify `backend/src/derivatives/{schemas.py, prompt.py, generate.py}`; Test `backend/tests/test_derivatives_card.py`.

**Interfaces:**
- Consumes: the same `wegofwd_llm` seam `generate_post` uses (`build_provider`, `generate_validated`, `LLMRequest`, `parse_json_response`).
- Produces: `CardSize`, `CardRequest`, `CardContent`, `CardResponse` (schemas); `build_card_prompt(source_text, size, tone) -> str`; `generate_card(*, source_text, size, tone, provider_id, api_key, model) -> CardContent`.

- [ ] **Step 1: Write the failing tests** (mocked provider)

```python
# backend/tests/test_derivatives_card.py
from unittest.mock import patch
from backend.src.derivatives import generate as gen
from backend.src.derivatives.schemas import CardRequest
import pytest
from pydantic import ValidationError

def test_card_request_requires_exactly_one_source():
    CardRequest(source_text="hello", size="square")            # ok
    CardRequest(topic_version_id="v1", size="linkedin")        # ok
    with pytest.raises(ValidationError):
        CardRequest(size="square")                              # neither
    with pytest.raises(ValidationError):
        CardRequest(source_text="x", topic_version_id="v1", size="square")  # both

def test_generate_card_returns_contract_from_the_model():
    class _Res:
        parsed = type("C", (), {"headline": "H", "subtext": "S", "source_label": None})()
    with patch("backend.src.derivatives.generate.generate_validated", return_value=_Res()):
        card = gen.generate_card(source_text="src", size="square", tone=None,
                                 provider_id="anthropic", api_key="k", model="m")
    assert card.headline == "H" and card.subtext == "S" and card.source_label is None
```

- [ ] **Step 2: Run — expect FAIL** (`cd backend && .venv/bin/python -m pytest tests/test_derivatives_card.py -v`)

- [ ] **Step 3: Implement schemas** (`derivatives/schemas.py` — add beside `DerivativeRequest`)

```python
from typing import Literal
from pydantic import BaseModel, Field, model_validator

CardSize = Literal["square", "linkedin", "story"]

class CardRequest(BaseModel):
    source_text: str | None = Field(default=None, min_length=1, max_length=20000)
    topic_version_id: str | None = None
    size: CardSize = "square"
    tone: str | None = None
    api_key: str | None = Field(default=None, min_length=20, max_length=512)
    provider_id: str = "anthropic"
    model: str | None = None

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "CardRequest":
        if bool(self.source_text) == bool(self.topic_version_id):
            raise ValueError("provide exactly one of source_text or topic_version_id")
        return self

class CardContent(BaseModel):
    headline: str
    subtext: str
    source_label: str | None = None

class CardResponse(BaseModel):
    card: CardContent
    size: CardSize
    image_png_base64: str
    provenance: str = "ai-generated"
```

- [ ] **Step 4: Implement the prompt** (`derivatives/prompt.py` — add `build_card_prompt`)

```python
def build_card_prompt(source_text: str, size: str, tone: str | None) -> str:
    tone_line = f"Tone: {tone}.\n" if tone else ""
    return (
        "You write a short, punchy quote/summary CARD that PROMOTES the source below. "
        "Invent nothing beyond the source.\n"
        f"{tone_line}"
        "Return ONLY JSON: {\"headline\": string, \"subtext\": string, \"source_label\": string|null}.\n"
        "headline: <= 60 characters, a hook. subtext: <= 160 characters, one or two lines. "
        "source_label: null (the caller may override it).\n\n"
        f"SOURCE:\n\"\"\"\n{source_text}\n\"\"\""
    )
```

- [ ] **Step 5: Implement `generate_card`** (`derivatives/generate.py` — mirror `generate_post`'s text path)

```python
from backend.src.derivatives.prompt import build_card_prompt
from backend.src.derivatives.schemas import CardContent

_CARD_MAX_TOKENS = 1024

def generate_card(*, source_text: str, size: str, tone: str | None,
                  provider_id: str, api_key: str, model: str) -> CardContent:
    """Generate the card copy for `source_text`. Never logs api_key. Raises
    LLMSchemaError on repair-budget exhaustion (router maps to 502)."""
    prompt = build_card_prompt(source_text, size, tone)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_CARD_MAX_TOKENS, response_format="json")

    def _validate(text: str) -> CardContent:
        return CardContent.model_validate(parse_json_response(text))

    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS).parsed
```

- [ ] **Step 6: Run — expect PASS**; **Step 7: `ruff format backend/ && ruff check backend/`**; **Step 8: Commit**

```bash
git add backend/src/derivatives/schemas.py backend/src/derivatives/prompt.py backend/src/derivatives/generate.py backend/tests/test_derivatives_card.py
git commit -m "feat(derivatives): card contract schemas + prompt + generate_card (P1-5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Backend card endpoint + trust seam + render

**Files:** Create `backend/src/derivatives/render.py`; Modify `backend/src/derivatives/router.py`; Test `backend/tests/test_derivatives_card_endpoint.py`.

**Interfaces:**
- Consumes: `generate_card` + `CardRequest`/`CardResponse`/`CardContent` (T2); `compileCard` via the CLI `--format card` (T1); the `make_post` key fork; the trust loaders `trust/topic_repo.get_topic_version` + `project_id_for_topic_version` + `trust/access.require_project_access`.
- Produces: `render.compile_card_png(card_input: dict) -> bytes`; `POST /api/v1/derivatives/card`.

- [ ] **Step 1: `render.py`** (compiler subprocess — mirror `export/compiler.py`)

```python
# backend/src/derivatives/render.py
"""Render a CardInput JSON to a PNG via the Node compiler (`--format card`).
Mirrors export/compiler.py's subprocess discipline; nothing hits disk, content
is never logged."""
from __future__ import annotations

import asyncio
import json

from backend.config import settings
from backend.src.core.log_redaction import get_logger

log = get_logger("derivatives.render")

class CardRenderError(RuntimeError):
    pass

async def compile_card_png(card_input: dict) -> bytes:
    argv = [settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", "card"]
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
    except asyncio.TimeoutError as exc:
        proc.kill()
        raise CardRenderError("card render timed out") from exc
    if proc.returncode != 0:
        log.error("card_render_failed", returncode=proc.returncode)
        raise CardRenderError("card render failed")
    return stdout
```

- [ ] **Step 2: Write the failing endpoint test** (mirror the `/derivatives/post` test harness)

```python
# backend/tests/test_derivatives_card_endpoint.py  (shape — adapt to the derivatives-post test fixtures)
# - POST /api/v1/derivatives/card with source_text + a BYOK api_key, provider mocked + compile_card_png
#   stubbed to return b"PNGBYTES" → 200, body.card present, body.image_png_base64 == base64("PNGBYTES"),
#   body.size echoed, provenance "ai-generated".
# - source_text AND topic_version_id both set → 422 (schema).
# - topic_version_id for a version the caller can read (owner/reviewer) → 200 and card.source_label like
#   "Based on N cited source(s)"; a non-member principal → 403/404.
# - managed-ineligible (no key, no entitlement/allowlist) → 400; over-cap → 429.
# - the api_key never appears in caplog.
```

- [ ] **Step 3: Run — expect FAIL** (endpoint 404)

- [ ] **Step 4: Implement the endpoint** (`router.py` — add beside `make_post`)

Copy `make_post`'s key-fork block VERBATIM (managed/BYOK, `resolve_managed_access`/`over_cap`/`is_managed_eligible`/`get_managed_key`, 400/429). The card-specific middle:

```python
@router.post("/card", response_model=CardResponse, dependencies=[Depends(enforce_rate_limit)])
async def make_card(body: CardRequest, request: Request,
                    principal: Principal | None = Depends(optional_user)) -> CardResponse:
    # --- key fork: copy verbatim from make_post (managed vs BYOK → api_key, model) ---
    # ...
    # --- source: flat text, or a validated topic-version section (access-gated) ---
    source_text = body.source_text or ""
    source_label: str | None = None
    if body.topic_version_id is not None:
        db_pool = getattr(request.app.state, "db", None)
        if db_pool is None or principal is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sign in to card a project section")
        async with db_pool.acquire() as conn:
            project_id = await topic_repo.project_id_for_topic_version(conn, topic_version_id=body.topic_version_id)
            if project_id is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
            account = await accounts_repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)
            await require_project_access(conn, account_id=account.id, project_id=project_id)  # 403 if none
            tv = await topic_repo.get_topic_version(conn, topic_version_id=body.topic_version_id)
            if tv is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
            sections = (tv.content or {}).get("sections", [])
            source_text = "\n\n".join(f"{s.get('heading','')}\n{s.get('body','')}" for s in sections).strip()
            cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
            source_label = f"Based on {len(cited)} cited source(s)" if cited else None
    # --- generate + render ---
    try:
        card = await asyncio.to_thread(
            generate_card, source_text=source_text, size=body.size, tone=body.tone,
            provider_id=body.provider_id, api_key=api_key, model=model)
    except LLMSchemaError:
        log.warning("card_validation_failed", size=body.size)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not generate the card")
    # a validated-section card uses the provenance label, overriding the model's:
    label = source_label if body.topic_version_id is not None else card.source_label
    card_input = {"headline": card.headline, "subtext": card.subtext, "source_label": label, "size": body.size}
    png = await compile_card_png(card_input)
    return CardResponse(card=CardContent(headline=card.headline, subtext=card.subtext, source_label=label),
                        size=body.size, image_png_base64=base64.b64encode(png).decode(), provenance="ai-generated")
```

Add imports: `base64`, `from backend.src.derivatives.generate import generate_card`, `from backend.src.derivatives.schemas import CardRequest, CardResponse, CardContent`, `from backend.src.derivatives.render import compile_card_png, CardRenderError`, `from backend.src.trust import topic_repo`, `from backend.src.trust.access import require_project_access`. Map `CardRenderError` → 502. Keep the `LLMError`/`LLMAuthError`/`LLMRateLimitError` handling parallel to `make_post`.

- [ ] **Step 5: Run — expect PASS**; **Step 6: `ruff format backend/ && ruff check backend/`** + confirm the no-key-in-logs path (`.venv/bin/python -m pytest tests/ -k "log or redact" -q`); **Step 7: Commit**

```bash
git add backend/src/derivatives/render.py backend/src/derivatives/router.py backend/tests/test_derivatives_card_endpoint.py
git commit -m "feat(derivatives): /card endpoint — trust-section seam + compiler render (P1-5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Mobile Publish surface (card mode)

**Files:** Modify `mobile/src/api/derivativesClient.ts`, `mobile/app/(tabs)/posts.tsx`, `mobile/src/components/navItems.ts`, `mobile/src/help-content/{features.ts, topics.ts}`; Create `mobile/src/hooks/useMakeCard.ts`; Test `mobile/__tests__/screens/Publish.card.test.tsx`.

**Interfaces:**
- Consumes: `POST /api/v1/derivatives/card` (T3); `downloadArtifact` from `@/api/client`; the user's validated topic-versions via the existing trust client (`useTrustProject`/`trustClient` — a version list the Publish screen can fetch).
- Produces: `makeCard(...)`, `CardSize`; `useMakeCard`; the card mode + unhidden "Publish" tab.

- [ ] **Step 1: Client call** (`derivativesClient.ts` — mirror `makePost`)

```ts
export type CardSize = "square" | "linkedin" | "story";
export interface MakeCardResponse {
  card: { headline: string; subtext: string; source_label: string | null };
  size: CardSize; image_png_base64: string; provenance: string;
}
export async function makeCard(req: {
  source_text?: string; topic_version_id?: string; size: CardSize; tone?: string;
  api_key?: string; provider_id?: string; model?: string;
}): Promise<MakeCardResponse> {
  if (IS_DEMO) throw new Error("Making a card is disabled in this demo build.");
  const res = await fetch(`${resolveBaseUrl()}/api/v1/derivatives/card`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req),
  });
  if (!res.ok) { const b = await res.text().catch(() => ""); throw new ApiError(res.status, b); }
  return res.json() as Promise<MakeCardResponse>;
}
```

- [ ] **Step 2: `useMakeCard`** — copy `useMakeCard` from `useMakePost.ts`'s structure (same `knownNotPro` key/Pro gate, same `run(...)` shape) calling `makeCard`.

- [ ] **Step 3: Write the failing test**

```tsx
// mobile/__tests__/screens/Publish.card.test.tsx  (mirror the existing posts test's mocks)
// - switch to Image card mode → the size selector + source field render
// - "Make card" with source text → calls makeCard with { source_text, size }
// - a returned MakeCardResponse renders the <Image> (data: URI) + the headline copy + a Download button
// - picking a validated section calls makeCard with { topic_version_id } (not source_text)
// - known-not-Pro without a key blocks with the add-key message
```

- [ ] **Step 4: Card mode in `posts.tsx`** — add a `mode` state (`"post" | "card"`) with a toggle. Card mode renders: a source switch (paste text | pick a validated topic-version — a simple list of the user's validated versions from the trust client; if none, show a hint), a size selector (Square / LinkedIn / Story), an optional tone field, and a "Make card" button wired to `useMakeCard`. On result, render `<Image source={{ uri: \`data:image/png;base64,${res.image_png_base64}\` }} style={...}/>`, the headline/subtext/source_label copy, and a **Download** button (`downloadArtifact(bytesFromBase64(res.image_png_base64), \`card.png\`, "image/png")` — reuse the base64→bytes helper the app already uses for artifacts, e.g. `fromBase64`). Keep the existing text-post mode untouched.

- [ ] **Step 5: Unhide + relabel the tab** (`navItems.ts`)

```ts
// relabel the posts tab:
posts: { label: NAV.publish, active: "megaphone", inactive: "megaphone-outline" },
// add to NAV_ORDER behind !IS_DEMO (beside projects/reviews):
export const NAV_ORDER: string[] = [
  "library",
  ...(IS_DEMO ? [] : ["projects", "reviews", "posts"]),
  "settings", "help", "about",
];
```

- [ ] **Step 6: Help DoD** — add a `publish-card` key to `features.ts` + a Help topic in `topics.ts` with that `featureKey` (explains the Publish surface: promote your own content as a text post or a branded image card; a validated-section card carries its cited-source count; download-only; billable LLM copy).

- [ ] **Step 7: Run the gates** (`cd mobile && npx tsc --noEmit && npx jest && npx eslint .` — all green incl. help/coverage + the new test); **Step 8: Commit**

```bash
git add mobile/src/api/derivativesClient.ts mobile/src/hooks/useMakeCard.ts "mobile/app/(tabs)/posts.tsx" mobile/src/components/navItems.ts mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/__tests__/screens/Publish.card.test.tsx
git commit -m "feat(publish): image-card mode + unhide the Publish tab (P1-5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Unit A→T1 (compileCard + `--format card`); Unit B→T2 (schemas/prompt/generate_card); Unit C→T3 (render.py + trust seam + endpoint); Unit D→T4 (client/hook/card mode/nav/Help). All covered. Deferred items (copy-edit loop, carousel/animated/audio, direct-publish, media reference, wegofwd extraction) are out-of-scope in both spec and plan.

**Placeholder scan:** T3's endpoint reuses `make_post`'s key fork "verbatim" (named source, exact functions) rather than reproducing ~35 lines of managed/BYOK boilerplate — the established pattern for this repo's derivative/generate endpoints; every new piece (render, seam, response assembly) is given in full. Every other step has concrete code.

**Type consistency:** `CardInput{headline,subtext,source_label?,size}` (compiler stdin) matches the `card_input` dict the backend writes in T3; `CardContent{headline,subtext,source_label}` (LLM contract) and `CardResponse{card,size,image_png_base64,provenance}` are identical across T2 (produce), T3 (return), T4 (TS `MakeCardResponse`). Sizes `square|linkedin|story` identical in compiler `SIZES`, `CardSize` (py), `CardSize` (ts). The provenance-label override (validated-section → `source_label` from `source_ids`, else the model's) is applied once in T3 and flows to both the rendered card and the response.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-08-17-publish-image-card-derivative.md`. Order T1→T2→T3→T4 (T1 gates T3's render; T2 gates T3's generate; T3 gates T4; T1/T2 independent).
