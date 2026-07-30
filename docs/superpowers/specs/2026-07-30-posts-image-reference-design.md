# Posts — Image Reference Input (FR-1b) — Design Spec

**Status:** Approved (2026-07-30) · **#338 FR-1b** (reference/guidance inputs, deferred from the Publishing Studio proposal) · first real use of a vision-input path (ADR-036 territory).
**Scope:** the Posts flow accepts an optional **reference image** that *steers* the generated posts (style/layout/tone) without being copied. Image-only. The vision call is **derivatives-local + Anthropic-only** (the shared `wegofwd-llm` seam is an external pinned package we don't edit here). Transient passthrough — the image is never stored or logged.

## Why derivatives-local (not the seam)
`wegofwd-llm` is installed from `git+…/wegofwd-llm@v0.2.0` (a separate repo, shared by 3 products); `LLMRequest` is text-only (`prompt: str`) and adding vision there is a cross-repo release. So the image path calls the **`anthropic` SDK directly** in `backend/src/derivatives/generate.py`; the existing **text-only path stays on the seam** (`build_provider`/`generate_validated`), unchanged.

## Grounding (verified)
- `anthropic` SDK 0.28.0 is in the backend venv (the seam already depends on it). Vision message shape: `messages=[{"role":"user","content":[{"type":"text","text":…},{"type":"image","source":{"type":"base64","media_type":…,"data":…}}]}]`.
- `derivatives/generate.py` `generate_post(*, source_text, platform, tone, provider_id, api_key, model)` → seam path today. `derivatives/router.py` resolves the key (BYOK/managed) + has the LLM-error cascade (`LLMSchemaError`/`LLMAuthError`/`LLMRateLimitError`/`LLMError`→ 502/429). `parse_json_response` from `backend.src.generate.anthropic_caller`; `_DerivativeOutput` in `derivatives/schemas.py`.
- Mobile EXIF-strip + base64 infra to reuse (`src/storage/mediaStore.ts`): `ImageManipulator.manipulateAsync(uri, [], { compress: 0.9, format })` re-encodes (strips EXIF/GPS); `FileSystem.readAsStringAsync(uri, { encoding: Base64 })`. Picker: `expo-image-picker` `launchImageLibraryAsync` (`FiguresPanel.tsx`). Allowed: jpeg/png/webp.

---

## Backend

### `schemas.py`
```python
ImageMediaType = Literal["image/jpeg", "image/png", "image/webp"]

class ReferenceImage(BaseModel):
    media_type: ImageMediaType
    data: str = Field(min_length=1, max_length=7_000_000)  # base64 (~5MB raw ≈ 6.7MB b64)

class DerivativeRequest(BaseModel):
    ...existing fields...
    image: ReferenceImage | None = None   # optional reference — steers, never copied
```

### `prompt.py`
`build_derivative_prompt(source_text, platform, tone=None, has_reference=False)` — when `has_reference`, append a guidance line:
> *"A reference image is attached. Take **only stylistic/structural guidance** from it — tone, layout, pacing, energy. Do NOT describe, transcribe, or reproduce the image, and do not treat it as a source of facts. The post's content comes ONLY from the source text above; the image just shapes the feel."*

### `generate.py` — vision branch
`generate_post(*, source_text, platform, tone, provider_id, api_key, model, image=None) -> DerivativeResponse`:
- **`image is None`** → the existing seam path (unchanged).
- **`image` present** → a direct Anthropic call (Anthropic-only; the router guarantees `provider_id == "anthropic"`):
  ```python
  import anthropic
  from wegofwd_llm.errors import LLMAuthError, LLMError, LLMRateLimitError, LLMSchemaError
  client = anthropic.Anthropic(api_key=api_key)
  content = [
      {"type": "text", "text": build_derivative_prompt(source_text, platform, tone, has_reference=True)},
      {"type": "image", "source": {"type": "base64", "media_type": image.media_type, "data": image.data}},
  ]
  try:
      resp = client.messages.create(model=model, max_tokens=_MAX_TOKENS,
                                    messages=[{"role": "user", "content": content}])
  except anthropic.AuthenticationError as e: raise LLMAuthError("anthropic rejected the credentials") from e
  except anthropic.PermissionDeniedError as e: raise LLMAuthError("anthropic denied the credentials") from e
  except anthropic.RateLimitError as e: raise LLMRateLimitError("anthropic rate-limited") from e
  except Exception as e: raise LLMError("anthropic vision call failed") from e
  text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
  try:
      out = _DerivativeOutput.model_validate(parse_json_response(text))
  except Exception as e: raise LLMSchemaError("generated content failed validation") from e
  return DerivativeResponse(platform=platform, variants=out.variants, provenance="ai-generated")
  ```
- **Key + image safety:** `api_key` goes only to `anthropic.Anthropic(api_key=…)` (never logged/returned); the `image.data` is used only in the call — **never logged, never stored, never in the response**. No single-call repair loop for the vision path (invalid JSON → `LLMSchemaError` → 502); note the non-parity with the seam's repair.

### `router.py`
- Pass `image=body.image` into `asyncio.to_thread(generate_post, …)`.
- **Guard:** if `body.image is not None and body.provider_id != "anthropic"` → `HTTPException(400, "a reference image requires the Anthropic provider")` (before any key/LLM work). The existing error cascade + rate-limit already cover the rest (the vision path raises the same `LLMError` subclasses).

## Mobile
- `src/lib/pickReferenceImage.ts` (small helper, reuses the media infra): `launchImageLibraryAsync({ mediaTypes: Images, quality: 1 })` → `manipulateAsync(uri, [], { compress: 0.9, format })` (EXIF strip) → `readAsStringAsync(uri, Base64)` → return `{ media_type, data } | null` (null on cancel). Reject non-jpeg/png/webp + oversize (~5MB) with a friendly alert.
- `derivativesClient.MakePostRequest` gains `image?: { media_type: string; data: string }`; `makePost` sends it.
- `useMakePost.run` accepts an optional `image` and forwards it; only the provider_id stays `anthropic` (already the default).
- `app/(tabs)/posts.tsx`: a **"Reference image (optional)"** row — an "Add image" button → `pickReferenceImage()` → a **thumbnail** (`<Image source={{uri:'data:'+media_type+';base64,'+data}}>`) + a remove ✕; helper copy: *"The model takes cues from this — it won't copy it."* Pass the image into `run({ sourceText, platform, tone, image })`. Keep the flex-scroll fix.

## Testing
**Backend** (`test_derivatives_post.py`, patch the Anthropic SDK client with a fake):
- image present (anthropic) → 200, 3 variants (fake vision response); the request's `data`/`api_key` never in the response (`json.dumps` assert).
- image + `provider_id != "anthropic"` → 400 (before any call).
- vision bad-JSON output → 502 (`LLMSchemaError`).
- no-image path unchanged (existing tests still green).
- prompt: `build_derivative_prompt(..., has_reference=True)` contains the "guidance … do not reproduce" instruction; `has_reference=False` does not.

**Mobile:** `pickReferenceImage` (mock expo-image-picker + ImageManipulator + FileSystem → returns `{media_type,data}`; cancel → null); `derivativesClient` sends `image` in the body; the Posts screen shows the thumbnail + remove after picking and passes `image` to `run`.

**Help / DoD:** extend the existing `make-a-post` Help topic with a line on the optional reference image (guidance-not-copy). No new FEATURES key.

## Out of scope (later)
- **Audio / video (≤2min)** references (transcription + keyframes).
- **Managed-key** vision (BYOK Anthropic only this slice) + **non-Anthropic** vision (needs the seam extension).
- Multiple reference images (one this slice).
- Server-side image resize/validation beyond size + declared media_type (client strips + caps).
- Extending the shared `wegofwd-llm` seam (separate-repo release).

## Open items (resolve in the plan, non-blocking)
1. Exact size cap (base64 `max_length` ~7MB ≈ 5MB raw) — plan fixes it + mirrors the client cap.
2. Anthropic SDK content-block access (`resp.content[i].text`) shape for 0.28.0 — the plan uses a defensive `getattr(b,"type",…)=="text"` join.
3. Whether the router should also reject a managed (`api_key is None`) request with an image — spec: managed + image is allowed only if the managed provider is Anthropic (the same `provider_id == "anthropic"` guard covers it; managed-vision entitlement is out of scope, so keep it simple — allow it, the resolved key is Anthropic's).
