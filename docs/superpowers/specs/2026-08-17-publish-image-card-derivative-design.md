# P1-5 (slice 1) — Publish: image/quote card derivative — Design

**Status:** Approved (brainstorming, 2026-08-17). First slice of P1-5 / ADR-037 **D8** ("Share = derivatives
now") — the [Short-Form Publishing Studio proposal](../../proposals/2026-07-27-short-form-publishing-studio.md)
**Phase 1 (Static)**. The proposal's *text-post* half already ships; this adds the **image/quote card**.

## Context (verified against the code)

- **The text-post derivative already ships** (nav-hidden). Full stack: `backend/src/derivatives/`
  (`router.py POST /api/v1/derivatives/post`, `generate.py generate_post`, `prompt.py`, `schemas.py`),
  `mobile/src/hooks/useMakePost.ts`, `mobile/src/api/derivativesClient.ts` (`Platform="linkedin"|"x"`,
  `PostVariant`, 3 server-enforced variants), `mobile/app/(tabs)/posts.tsx`. The endpoint is **inline
  (not the async export job)**, key-forked managed-or-BYOK (`access.resolve_managed_access` → `over_cap`,
  `is_managed_eligible` fallback, `get_managed_key`), never logs the key.
- **The card's building blocks all exist:**
  - LLM seam — `wegofwd_llm`: `build_provider`, `generate_validated` conformance/repair loop
    (`_MAX_REPAIRS=2`), `LLMRequest`, `parse_json_response` — exactly what `generate_post` uses.
  - Branded SVG — `compiler/src/cover.ts` `buildCoverSvg(input: CoverInput): string` (STUDIO navy/gold
    palette from `./tokens`, embedded display/serif/sans fonts, `viewBox 0 0 1600 2560`, fit-to-width
    title/subtitle/byline helpers `splitTitle`/`fitTitle`). A quote-card template is a near-direct fork.
  - Rasterizer — `compiler/src/rasterize.ts` `rasterizeToPng({html?|svg?, width?, omitBackground?})`
    (headless Chromium, `deviceScaleFactor: 2`). The `/export?format=cover` path already invokes the
    compiler **synchronously** to produce a cover PNG.
  - Compiler subprocess — `backend/src/export/compiler.py` shells `node_bin compiler_cli - -o - --format
    <fmt>` over stdin/stdout (`asyncio.create_subprocess_exec`, timeouts, `CompilerError`). The card
    render mirrors this with `--format card`.
  - Trust source — a validated topic version's `content.sections[].{heading, body, source_ids}` is
    loadable via `trust/topic_repo.get_topic_version` + `project_id_for_topic_version`, access-gated by
    `trust/access.require_project_access`.
- **Nav** — `mobile/src/components/navItems.ts`: `posts` has a `NAV_TABS` entry (megaphone icon) but is
  **absent from `NAV_ORDER`** (route alive, tab hidden). `mobile/src/constants/labels.ts` already defines
  **`NAV.publish = "Publish"`**. `NAV_ORDER` gates `projects`/`reviews` behind `!IS_DEMO`.
- **Gating precedent** — derivative generation is Pro/managed-or-BYOK in the paid app, never the free
  reader; the demo build blocks the call (`derivativesClient.ts IS_DEMO`). Card render is **free**
  (Chromium) → no new metered cost; the only billable step is the LLM copy, covered by the existing fork.

## Decisions (brainstorming 2026-08-17)

1. **Ship the image/quote card** (text quote/summary card: headline + subtext + source label + brand
   mark). No embedded diagram this slice.
2. **Two source inputs:** flat pasted **source text** (like Posts) AND a picked **validated topic-version
   section**, which carries its `source_ids` onto the card as provenance (ADR-037 cornerstone→derivative).
3. **Three sizes:** `square` 1080×1080, `linkedin` 1200×627, `story` 1080×1920 (portrait reflow).
4. **Surface = "Publish" tab:** add the card mode to `posts.tsx`, relabel the tab `NAV.publish`, and
   **unhide it** (`NAV_ORDER`, behind `!IS_DEMO` like projects/reviews).
5. **One-shot render, inline** (mirror `/derivatives/post` + the sync cover render) — the endpoint returns
   the rendered card + its copy in one call. In-app copy-edit-rerender is a follow-up.
6. **No new `wegofwd-*` package this slice.** The render engine already lives in the compiler (the shared
   render layer); a new package for one card renderer is premature extraction (cf. `wegofwd-help` has no
   second consumer). Extract when a second consumer appears. *(This is a deliberate deviation from the
   proposal's "extractable from day one," recorded here.)*

## Architecture

```
Publish tab (posts.tsx)  ── Text post (shipped)  |  Image card (NEW)
   card mode: paste text  OR  pick a validated topic-version section  + size + tone
        │
        ▼  POST /api/v1/derivatives/card   (key fork mirrors /derivatives/post; render free)
   backend/src/derivatives:
     1. if topic_version_id → load version (access-gated) → assemble sections → source_text
        + source_label from source_ids            [trust→derivative seam]
     2. generate_card (generate_validated seam)   → { headline, subtext, source_label }
     3. shell compiler --format card (CardInput JSON on stdin → PNG on stdout)   [mirror export/compiler.py]
        ▼
   { card:{headline,subtext,source_label}, size, image_png_base64, provenance:"ai-generated" }
        ▼  mobile shows the PNG + the copy + Download (downloadArtifact)
```

---

## Unit A — Compiler: card renderer (`compiler/src/card.ts`)

**Files:** create `compiler/src/card.ts`; modify `compiler/src/cli.ts`; tests `compiler/__tests__/card.test.ts`.

**Interfaces:**
- `export interface CardInput { headline: string; subtext: string; source_label?: string; size: "square" | "linkedin" | "story" }`.
- `export async function compileCard(input: CardInput): Promise<Buffer>` — branded SVG → `rasterizeToPng` → PNG.
- CLI `--format card`: stdin is a **CardInput JSON** (not a book); dispatch to `compileCard`; PNG to stdout.

**Behavior:**
- `SIZES: Record<CardInput["size"], {w: number; h: number}>` = `{square:{1080,1080}, linkedin:{1200,627}, story:{1080,1920}}`.
- `buildCardSvg(input): string` — fork `buildCoverSvg`'s branded approach (STUDIO palette from `./tokens`,
  the embedded fonts, `fitTitle`-style fit-to-width): a background panel, the **headline** (large display,
  wrapped, fit to width), the **subtext** (smaller, wrapped), a muted **source label** line when present,
  and the brand mark — laid out per size (`story` is portrait; `linkedin` is landscape). `viewBox 0 0 w h`.
- `compileCard` → `rasterizeToPng({ svg: buildCardSvg(input), width: SIZES[size].w })`.
- Runtime-optional Chromium (via `rasterizeToPng`, which throws cleanly if puppeteer is absent) — same as
  cover.

**CLI change** (`cli.ts`): add `"card"` to the `Format` union + the `--format` parse arm; when `format ===
"card"`, parse stdin as `CardInput` (not `Book`) and `out = await compileCard(cardInput)`.

**Tests (CI-safe — no real puppeteer):** `buildCardSvg` returns an SVG containing the headline/subtext/
source-label text for each size, with the right `viewBox` dimensions. (The PNG rasterize path needs
Chromium — assert the SVG contract like the cover tests do, not a live screenshot.)

## Unit B — Backend: card contract generator (`derivatives/generate.py` + `prompt.py` + `schemas.py`)

**Files:** modify `backend/src/derivatives/{schemas.py, prompt.py, generate.py}`; tests
`backend/tests/test_derivatives_card.py`.

**Interfaces:**
- `schemas.py`: `CardSize = Literal["square","linkedin","story"]`; `CardRequest(BaseModel)` = `{source_text:
  str|None, topic_version_id: str|None, size: CardSize="square", tone: str|None=None, api_key: str|None,
  provider_id: str="anthropic", model: str|None=None}` with a `model_validator` requiring **exactly one** of
  `source_text`/`topic_version_id`; `CardContent = {headline: str, subtext: str, source_label: str|None}`;
  `CardResponse = {card: CardContent, size: CardSize, image_png_base64: str, provenance: str="ai-generated"}`.
  `_CardOutput` (the model's validated JSON) = `{headline, subtext, source_label?}`.
- `prompt.py`: `build_card_prompt(source_text: str, size: CardSize, tone: str|None) -> str` — instruct a
  punchy `{headline (≤~60 chars), subtext (≤~160 chars), source_label?}`; "PROMOTE the source, invent
  nothing beyond it"; length guidance per size (story can carry a touch more). Return-only JSON
  `{"headline","subtext","source_label"}`.
- `generate.py`: `generate_card(*, source_text, size, tone, provider_id, api_key, model) -> CardContent` —
  `build_provider` + `generate_validated(provider, LLMRequest(prompt, max_tokens=1024, response_format="json"),
  _validate, max_repairs=2)`; `_validate` coerces to `_CardOutput`. Returns the `CardContent` (the router
  renders + wraps).

**Tests:** mocked-provider — `generate_card` returns a `CardContent` from the mocked JSON; a bad status/
missing field repairs or 502s (mirror `generate_post` tests); the prompt embeds the source + size rules.

## Unit C — Backend: card endpoint + trust seam + render (`derivatives/router.py` + a small render + seam helper)

**Files:** modify `backend/src/derivatives/router.py`; add `backend/src/derivatives/render.py` (compiler
subprocess) and the trust-seam loader (in `router.py` or a `source.py`); tests
`backend/tests/test_derivatives_card_endpoint.py`.

**Interfaces:**
- `POST /api/v1/derivatives/card` → `CardResponse`. Key fork **copied verbatim** from `make_post`
  (managed-or-BYOK, `resolve_managed_access`/`over_cap`/`is_managed_eligible`/`get_managed_key`, 400/429).
- **Trust seam:** when `body.topic_version_id` is set — resolve `project_id_for_topic_version`, require an
  authenticated principal + `require_project_access` (owner/reviewer/editor; 403/404 otherwise), load
  `get_topic_version`, assemble `source_text` = the version's `content.sections` joined as
  `"{heading}\n{body}"`, and derive `source_label` = `"Based on {n} cited source(s)"` from the distinct
  `source_ids` across sections (0 → no label). The **model-generated `source_label`** is overridden by this
  provenance label when the card is from a validated section.
- **Render:** `render.py compile_card_png(card_input: dict) -> bytes` — `asyncio.create_subprocess_exec(
  settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", "card")`, write the CardInput JSON
  to stdin, read PNG from stdout, timeout `settings.export_timeout_seconds`, `CompilerError` on failure —
  mirror `export/compiler.py`. Never log the content.
- Handler flow: key fork → (seam if topic_version_id) → `generate_card` (off-loop via `asyncio.to_thread`)
  → build CardInput → `compile_card_png` → base64 → `CardResponse`. LLMSchemaError → 502; never the key.

**Tests:** `/derivatives/card` — 200 from `source_text` (mock the provider + stub the compiler subprocess
to return a PNG); from `topic_version_id` carries the `source_label` and is access-gated (reviewer of the
project 200, a non-member 403/404); exactly-one-source validation → 422; managed-ineligible → 400,
over-cap → 429; the key never appears in logs.

## Unit D — Mobile: Publish surface (card mode)

**Files:** modify `mobile/src/api/derivativesClient.ts`, add `mobile/src/hooks/useMakeCard.ts`, modify
`mobile/app/(tabs)/posts.tsx`, `mobile/src/components/navItems.ts`, `mobile/src/help-content/{features.ts,
topics.ts}`; tests `mobile/__tests__/screens/Publish.card.test.tsx`.

**Interfaces:**
- `derivativesClient.ts`: `CardSize = "square"|"linkedin"|"story"`; `makeCard(req: {source_text?:
  string; topic_version_id?: string; size: CardSize; tone?: string; api_key?; provider_id?; model?}):
  Promise<{card:{headline:string;subtext:string;source_label:string|null}; size:CardSize;
  image_png_base64:string; provenance:string}>` → `POST /api/v1/derivatives/card` (mirror `makePost`;
  `IS_DEMO` blocks).
- `useMakeCard` — mirror `useMakePost`'s `knownNotPro` key/Pro gating.
- `posts.tsx` → a **mode toggle** (Text post | Image card). Card mode: source = paste text **or** pick one
  of the user's **validated topic-versions** (a small picker sourced from the trust projects/versions the
  user can read); a **size** selector (Square / LinkedIn / Story); optional tone; "Make card" →
  render the returned PNG (`<Image source={{uri: 'data:image/png;base64,' + image_png_base64}}>`), show the
  copy (headline/subtext/source_label) + a **Download** (reuse `downloadArtifact`, mime `image/png`).
- `navItems.ts`: relabel the `posts` tab to `NAV.publish`, and add `"posts"` to `NAV_ORDER` behind
  `!IS_DEMO` (beside projects/reviews).
- **Help DoD:** a `publish-card` `FEATURES` key + a Help topic (in this task).

**Tests:** card mode renders the returned image + copy + Download; picking a validated section calls
`makeCard` with `topic_version_id`; the size selector passes the chosen size; gating (known-not-Pro without
a key blocks); the Publish tab appears in `NAV_ORDER` when `!IS_DEMO`.

---

## Cross-cutting / global constraints

- **BYOK/ADR-001:** the card's LLM call obeys the same discipline as `/derivatives/post` — key never logged/
  persisted, resolved via the managed vault or the BYOK body; source text + section content never logged.
- **Access:** the trust seam gates a `topic_version_id` card on `require_project_access`
  (owner/reviewer/editor) — a user can only card a project they can read. Flat `source_text` needs no trust
  access (it's the caller's own text), same as `/derivatives/post`.
- **Gating:** Pro/managed-or-BYOK, paid app only; `IS_DEMO` blocks the call and hides the tab.
- **No migration**, no new table. Card render is free (Chromium); no new metered cost.
- asyncpg; no key/content in logs; 70% coverage. Compiler jest + backend pytest + mobile
  (`tsc`/`jest`/`eslint`) green; `ruff check` **and** `ruff format --check` clean on backend (a recurring
  CI gate — run `ruff format` before committing). `useThemedStyles`; no color-literal test asserts.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Decomposition (SDD)

- **T1 — Compiler card renderer (Unit A):** `card.ts` `compileCard` + `buildCardSvg` (3 sizes, forked from
  `buildCoverSvg`) + `--format card` CLI dispatch. SVG-contract tests.
- **T2 — Backend card contract (Unit B):** `schemas.CardRequest`/`CardContent`/`CardResponse` + `prompt.
  build_card_prompt` + `generate.generate_card`. Mocked-provider tests.
- **T3 — Backend endpoint + trust seam + render (Unit C):** `render.compile_card_png` (compiler
  subprocess), the topic-version→source_text+source_label seam (access-gated), `POST /derivatives/card`
  (key fork copied from `make_post`). Endpoint tests.
- **T4 — Mobile Publish surface (Unit D):** `makeCard` + `useMakeCard` + `posts.tsx` card mode + validated-
  section picker + size selector + download + nav unhide/relabel + Help topic. Tests.

(T1 gates T3's render; T2 gates T3's generate; T3 gates T4's endpoint. T1/T2 are independent and can
interleave.)

## Rollout

Backend refresh (new endpoint + the compiler image already carries Chromium for cover; the `card` format is
new code in the same image) + web deploy + APK. No migration. The card LLM copy is billable (managed/BYOK,
same as posts); the render is free.

## Out of scope / follow-ups (per the proposal's phasing)

- **Copy-edit-rerender loop** in-app (this slice is one-shot).
- **Carousel** (multi-frame), **animated card** (GIF/MP4 encode), **audio/TTS**, **A/V** — later phases.
- **Direct-publish / OAuth** (ADR-037 D8 d2 — deferred).
- **Image/media reference inputs** for the card (FR-1b) — the post path has an image ref; the card can gain
  one later.
- **Embedded diagram/figure** on the card (a richer template).
- **Extracting the render engine to a `wegofwd-*` package** — when a second consumer appears.

## Open (non-blocking)

- Brand-kit multiplicity (one brand mark this slice; per-brand kits later).
- The validated-section picker's exact source (the user's projects → validated topic-versions) — resolved
  in T4 against the existing trust client (`useTrustProject`/`trustClient`); if no lightweight "my validated
  versions" list exists, the picker reads from the project detail the Publish screen can already fetch.
