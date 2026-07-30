# Posts Image-Reference (FR-1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Posts flow accept one optional reference image that *steers* the generated posts (style/tone/layout) without being copied.

**Architecture:** Backend `/derivatives/post` gains an optional `image` (base64 + media_type). No image → the existing seam path (unchanged). Image present → a **derivatives-local Anthropic vision call** (SDK multimodal, Anthropic-only) that re-raises the seam's `LLMError` subclasses so the router's error cascade is untouched. Mobile reuses the existing EXIF-strip + image-picker infra to produce base64.

**Tech Stack:** FastAPI · Pydantic v2 · `anthropic` SDK 0.28.0 · React Native + Expo (`expo-image-picker`, `expo-image-manipulator`, `expo-file-system`).

**Spec:** `docs/superpowers/specs/2026-07-30-posts-image-reference-design.md`

## Global Constraints

- **Key + image are transient passthrough.** `api_key` and `image.data` are NEVER logged, persisted, or echoed in any response (ADR-001 discipline; ADR-036 custody). Type-only log lines.
- **Anthropic-only for the image path.** `image` present + `provider_id != "anthropic"` → HTTP 400 before any key/LLM work.
- **Provenance stays `"ai-generated"`.** No new provenance value.
- **Image formats:** `image/jpeg`, `image/png`, `image/webp` only. Base64 `data` capped at `7_000_000` chars (~5 MB raw).
- **No new Help FEATURES key** — extend the existing `make-a-post` topic only.
- **Never hit live Anthropic / Redis / DB in CI.** Patch the SDK client.
- `ruff format backend/` and `npx eslint` must pass locally before commit (CI runs both whole-dir).

---

### Task 1: Backend schema — `ReferenceImage` + optional `image`

**Files:**
- Modify: `backend/src/derivatives/schemas.py`
- Test: `backend/tests/test_derivatives_schemas.py` (create)

**Interfaces:**
- Produces: `ReferenceImage(media_type: Literal["image/jpeg","image/png","image/webp"], data: str)`; `DerivativeRequest.image: ReferenceImage | None = None`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_derivatives_schemas.py
"""Schema tests for the optional reference image on DerivativeRequest (FR-1b)."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.src.derivatives.schemas import DerivativeRequest, ReferenceImage


def test_image_optional_defaults_none():
    req = DerivativeRequest(source_text="s", api_key="sk-ant-" + "x" * 20)
    assert req.image is None


def test_image_accepts_valid():
    req = DerivativeRequest(
        source_text="s",
        api_key="sk-ant-" + "x" * 20,
        image={"media_type": "image/png", "data": "aGVsbG8="},
    )
    assert isinstance(req.image, ReferenceImage)
    assert req.image.media_type == "image/png"


def test_image_rejects_bad_media_type():
    with pytest.raises(ValidationError):
        DerivativeRequest(
            source_text="s",
            api_key="sk-ant-" + "x" * 20,
            image={"media_type": "image/gif", "data": "aGVsbG8="},
        )


def test_image_rejects_oversize_data():
    with pytest.raises(ValidationError):
        DerivativeRequest(
            source_text="s",
            api_key="sk-ant-" + "x" * 20,
            image={"media_type": "image/png", "data": "a" * 7_000_001},
        )
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_derivatives_schemas.py -q`
Expected: FAIL — `ImportError: cannot import name 'ReferenceImage'`.

- [ ] **Step 3: Implement**

In `backend/src/derivatives/schemas.py`, after the `Platform` alias add:

```python
ImageMediaType = Literal["image/jpeg", "image/png", "image/webp"]


class ReferenceImage(BaseModel):
    """An optional reference image that STEERS post style — never copied.

    Transient: the base64 `data` is passed straight to the vision call and is
    never logged or persisted (ADR-001 / ADR-036 custody).
    """

    media_type: ImageMediaType
    # base64-encoded bytes. Capped ~5 MB raw (~6.7 MB base64) to bound the payload.
    data: str = Field(min_length=1, max_length=7_000_000)
```

And add to `DerivativeRequest` (after `model`):

```python
    # Optional reference image (FR-1b). Steers style/tone/layout only — the
    # backend instructs the model NOT to reproduce it. Anthropic-only (the
    # router rejects image + non-anthropic with a 400).
    image: ReferenceImage | None = None
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && python -m pytest tests/test_derivatives_schemas.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Format + commit**

```bash
cd backend && ruff format src/derivatives/schemas.py tests/test_derivatives_schemas.py
git add backend/src/derivatives/schemas.py backend/tests/test_derivatives_schemas.py
git commit -m "feat(derivatives): ReferenceImage schema + optional image on request (FR-1b)"
```

---

### Task 2: Backend prompt — `has_reference` guidance line

**Files:**
- Modify: `backend/src/derivatives/prompt.py`
- Test: `backend/tests/test_derivatives_prompt.py` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `build_derivative_prompt(source_text, platform, tone=None, has_reference=False) -> str`.

- [ ] **Step 1: Write the failing test** (append to `test_derivatives_prompt.py`)

```python
def test_reference_guidance_present_when_flagged():
    p = build_derivative_prompt("src", "linkedin", has_reference=True)
    assert "reference image" in p.lower()
    assert "do not" in p.lower() and "reproduce" in p.lower()


def test_no_reference_guidance_by_default():
    p = build_derivative_prompt("src", "linkedin")
    assert "reference image" not in p.lower()
```

(Ensure `build_derivative_prompt` is imported at the top of the test file — it already is if the file tests it; otherwise add `from backend.src.derivatives.prompt import build_derivative_prompt`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_derivatives_prompt.py -q`
Expected: FAIL — `has_reference` is an unexpected keyword arg.

- [ ] **Step 3: Implement**

In `backend/src/derivatives/prompt.py` change the signature + append the guidance:

```python
def build_derivative_prompt(
    source_text: str, platform: str, tone: str | None = None, has_reference: bool = False
) -> str:
```

Before the `return`, build a reference line:

```python
    reference_line = (
        "\n\nA reference image is attached. Take ONLY stylistic and structural "
        "guidance from it — tone, layout, pacing, energy. Do NOT describe, "
        "transcribe, or reproduce the image, and do not treat it as a source of "
        "facts. The post content comes ONLY from the source material above."
        if has_reference
        else ""
    )
```

Insert `{reference_line}` into the returned string immediately after the `SOURCE:` block (before the `Respond with ONLY valid JSON` line).

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && python -m pytest tests/test_derivatives_prompt.py -q`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
cd backend && ruff format src/derivatives/prompt.py tests/test_derivatives_prompt.py
git add backend/src/derivatives/prompt.py backend/tests/test_derivatives_prompt.py
git commit -m "feat(derivatives): reference-image guidance line in prompt (FR-1b)"
```

---

### Task 3: Backend `generate_post` — vision branch

**Files:**
- Modify: `backend/src/derivatives/generate.py`
- Test: `backend/tests/test_derivatives_generate.py` (append)

**Interfaces:**
- Consumes: `ReferenceImage` (Task 1), `build_derivative_prompt(..., has_reference=...)` (Task 2).
- Produces: `generate_post(*, source_text, platform, tone, provider_id, api_key, model, image: ReferenceImage | None = None) -> DerivativeResponse`.

**Note:** import the SDK as `import anthropic` and call `anthropic.Anthropic(...)` so tests patch `backend.src.derivatives.generate.anthropic.Anthropic`. Single call, no repair loop on the vision path (invalid JSON → `LLMSchemaError` → router 502).

- [ ] **Step 1: Write the failing test** (append to `test_derivatives_generate.py`)

```python
from unittest.mock import MagicMock, patch

from backend.src.derivatives.schemas import ReferenceImage

_GOOD_JSON = (
    '{"variants": ['
    '{"hook":"h0","body":"b0","hashtags":["#x"],"cta":null},'
    '{"hook":"h1","body":"b1","hashtags":["#x"],"cta":null},'
    '{"hook":"h2","body":"b2","hashtags":["#x"],"cta":null}]}'
)


def _fake_anthropic(text):
    block = MagicMock()
    block.type = "text"
    block.text = text
    client = MagicMock()
    client.messages.create.return_value = MagicMock(content=[block])
    factory = MagicMock(return_value=client)
    return factory, client


def test_vision_path_returns_variants_and_sends_image():
    factory, client = _fake_anthropic(_GOOD_JSON)
    img = ReferenceImage(media_type="image/png", data="aGk=")
    with patch("backend.src.derivatives.generate.anthropic.Anthropic", factory):
        out = generate_post(
            source_text="Stormwater.",
            platform="linkedin",
            tone=None,
            provider_id="anthropic",
            api_key="sk-ant-secret",
            model="claude-x",
            image=img,
        )
    assert len(out.variants) == 3
    assert out.provenance == "ai-generated"
    # The image block reached the SDK call.
    sent = client.messages.create.call_args.kwargs["messages"][0]["content"]
    assert any(b.get("type") == "image" for b in sent)
    # BYOK key went only to the client factory, not into the response.
    factory.assert_called_once_with(api_key="sk-ant-secret")


def test_vision_bad_json_raises_schema_error():
    from wegofwd_llm.errors import LLMSchemaError

    factory, _ = _fake_anthropic("not json at all")
    img = ReferenceImage(media_type="image/png", data="aGk=")
    with patch("backend.src.derivatives.generate.anthropic.Anthropic", factory):
        with pytest.raises(LLMSchemaError):
            generate_post(
                source_text="s", platform="x", tone=None, provider_id="anthropic",
                api_key="sk-ant-secret", model="claude-x", image=img,
            )
```

(Add `import pytest` / `generate_post` import if not already present at the top of the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_derivatives_generate.py -q`
Expected: FAIL — `generate_post()` got an unexpected keyword `image`.

- [ ] **Step 3: Implement**

In `backend/src/derivatives/generate.py`:

Add imports at the top of the module:

```python
import anthropic
from wegofwd_llm.errors import LLMAuthError, LLMError, LLMRateLimitError, LLMSchemaError

from .schemas import DerivativeResponse, PostVariant, ReferenceImage, _DerivativeOutput
```

(Merge `ReferenceImage` into the existing `.schemas` import line rather than duplicating it.)

Change the signature to add `image: ReferenceImage | None = None`, and branch at the top of the body:

```python
    if image is not None:
        return _generate_post_with_image(
            source_text=source_text, platform=platform, tone=tone,
            api_key=api_key, model=model, image=image,
        )
```

Add the helper below `generate_post`:

```python
def _generate_post_with_image(
    *,
    source_text: str,
    platform: str,
    tone: str | None,
    api_key: str,
    model: str,
    image: ReferenceImage,
) -> DerivativeResponse:
    """Vision variant of generate_post — Anthropic-only, single call.

    Bypasses the text seam (LLMRequest is text-only) but re-raises the seam's
    LLMError subclasses so the router's cascade is unchanged. api_key and
    image.data are transient — never logged or returned.
    """
    prompt = build_derivative_prompt(source_text, platform, tone, has_reference=True)
    content = [
        {"type": "text", "text": prompt},
        {
            "type": "image",
            "source": {"type": "base64", "media_type": image.media_type, "data": image.data},
        },
    ]
    client = anthropic.Anthropic(api_key=api_key)
    try:
        resp = client.messages.create(
            model=model, max_tokens=_MAX_TOKENS,
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.AuthenticationError as e:
        raise LLMAuthError("anthropic rejected the credentials") from e
    except anthropic.PermissionDeniedError as e:
        raise LLMAuthError("anthropic denied the credentials") from e
    except anthropic.RateLimitError as e:
        raise LLMRateLimitError("anthropic rate-limited") from e
    except Exception as e:  # transport / unexpected — key-free
        raise LLMError("anthropic vision call failed") from e

    text = "".join(
        b.text for b in resp.content if getattr(b, "type", None) == "text"
    )
    try:
        out = _DerivativeOutput.model_validate(parse_json_response(text))
    except Exception as e:
        raise LLMSchemaError("generated content failed validation") from e
    variants: list[PostVariant] = out.variants
    return DerivativeResponse(platform=platform, variants=variants, provenance="ai-generated")
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && python -m pytest tests/test_derivatives_generate.py -q`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Format + commit**

```bash
cd backend && ruff format src/derivatives/generate.py tests/test_derivatives_generate.py
git add backend/src/derivatives/generate.py backend/tests/test_derivatives_generate.py
git commit -m "feat(derivatives): Anthropic vision branch in generate_post (FR-1b)"
```

---

### Task 4: Backend router — pass image + Anthropic-only guard

**Files:**
- Modify: `backend/src/derivatives/router.py`
- Test: `backend/tests/test_derivatives_post.py` (append)

**Interfaces:**
- Consumes: `generate_post(..., image=...)` (Task 3).

- [ ] **Step 1: Write the failing test** (append to `test_derivatives_post.py`)

```python
from unittest.mock import MagicMock


def _fake_anthropic_factory(text):
    block = MagicMock(); block.type = "text"; block.text = text
    client = MagicMock()
    client.messages.create.return_value = MagicMock(content=[block])
    return MagicMock(return_value=client)


async def test_image_ok_anthropic(client, known_test_api_key):
    with patch(
        "backend.src.derivatives.generate.anthropic.Anthropic",
        _fake_anthropic_factory(_GOOD),
    ):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={
                "source_text": "s",
                "api_key": known_test_api_key,
                "image": {"media_type": "image/png", "data": "aGk="},
            },
        )
    assert r.status_code == 200
    assert len(r.json()["variants"]) == 3
    assert known_test_api_key not in json.dumps(r.json())


async def test_image_non_anthropic_provider_400(client):
    r = await client.post(
        "/api/v1/derivatives/post",
        json={
            "source_text": "s",
            "provider_id": "openai",
            "api_key": "sk-" + "y" * 40,
            "image": {"media_type": "image/png", "data": "aGk="},
        },
    )
    assert r.status_code == 400
```

(If `openai` is not in `PROVIDER_REGISTRY`, the request 422s at schema validation instead — in that case use any registered non-anthropic provider id from the registry, or, if none exists, assert the guard directly by patching `body.provider_id`. Confirm registered ids first: `python -c "from wegofwd_llm.registry import PROVIDER_REGISTRY; print(list(PROVIDER_REGISTRY))"`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_derivatives_post.py -q`
Expected: FAIL — no guard yet / image not forwarded.

- [ ] **Step 3: Implement**

In `backend/src/derivatives/router.py`, inside `make_post`, before the `managed = ...` line add the guard:

```python
    # A reference image requires vision — Anthropic-only this slice (FR-1b).
    if body.image is not None and body.provider_id != "anthropic":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="a reference image requires the Anthropic provider",
        )
```

And pass `image=body.image` into the `asyncio.to_thread(generate_post, ...)` call.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && python -m pytest tests/test_derivatives_post.py -q`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Full backend gate + commit**

```bash
cd backend && ruff format src/derivatives/router.py tests/test_derivatives_post.py && ruff check src/derivatives/ && python -m pytest tests/test_derivatives_post.py tests/test_derivatives_generate.py tests/test_derivatives_prompt.py tests/test_derivatives_schemas.py -q
git add backend/src/derivatives/router.py backend/tests/test_derivatives_post.py
git commit -m "feat(derivatives): forward image + Anthropic-only guard on /post (FR-1b)"
```

---

### Task 5: Mobile — `pickReferenceImage` helper

**Files:**
- Create: `mobile/src/lib/pickReferenceImage.ts`
- Test: `mobile/__tests__/lib/pickReferenceImage.test.ts` (create)

**Interfaces:**
- Produces: `pickReferenceImage(): Promise<{ media_type: string; data: string } | null>` (null on cancel; throws `Error` with a friendly message on unsupported/oversize).

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/lib/pickReferenceImage.test.ts
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";
import { pickReferenceImage } from "@/lib/pickReferenceImage";

jest.mock("expo-image-picker");
jest.mock("expo-image-manipulator");
jest.mock("expo-file-system");

const IP = ImagePicker as jest.Mocked<typeof ImagePicker>;
const IM = ImageManipulator as jest.Mocked<typeof ImageManipulator>;
const FS = FileSystem as jest.Mocked<typeof FileSystem>;

beforeEach(() => {
  jest.clearAllMocks();
  (IP as any).MediaTypeOptions = { Images: "Images" };
  (IM as any).SaveFormat = { JPEG: "jpeg", PNG: "png", WEBP: "webp" };
  (FS as any).EncodingType = { Base64: "base64" };
  IP.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as any);
});

test("returns null when the user cancels", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({ canceled: true } as any);
  expect(await pickReferenceImage()).toBeNull();
});

test("strips EXIF and returns base64 + media_type", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://x.png", mimeType: "image/png", fileSize: 1000 }],
  } as any);
  IM.manipulateAsync.mockResolvedValue({ uri: "file://stripped.png" } as any);
  FS.getInfoAsync.mockResolvedValue({ exists: true, size: 1000 } as any);
  FS.readAsStringAsync.mockResolvedValue("BASE64DATA");

  const out = await pickReferenceImage();
  expect(out).toEqual({ media_type: "image/png", data: "BASE64DATA" });
  // EXIF strip ran (no transform ops).
  expect(IM.manipulateAsync).toHaveBeenCalledWith("file://x.png", [], expect.any(Object));
});

test("rejects an unsupported format", async () => {
  IP.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://x.gif", mimeType: "image/gif", fileSize: 10 }],
  } as any);
  await expect(pickReferenceImage()).rejects.toThrow(/JPEG, PNG or WebP/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npx jest __tests__/lib/pickReferenceImage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// mobile/src/lib/pickReferenceImage.ts
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

export type ReferenceImage = { media_type: string; data: string };

const SAVE_FORMAT: Record<string, ImageManipulator.SaveFormat> = {
  "image/jpeg": ImageManipulator.SaveFormat.JPEG,
  "image/png": ImageManipulator.SaveFormat.PNG,
  "image/webp": ImageManipulator.SaveFormat.WEBP,
};
// ~5 MB raw. Mirrors the backend base64 cap (7_000_000 chars).
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Pick one image from the library, strip its EXIF (re-encode, no transform),
 * and return base64 + media_type. `null` if the user cancels. Throws a
 * friendly Error for an unsupported format or an oversize file. The bytes stay
 * on-device except as the transient reference sent with the post request.
 */
export async function pickReferenceImage(): Promise<ReferenceImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Photo access is needed to add a reference image.");

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
  });
  if (res.canceled || !res.assets?.length) return null;

  const asset = res.assets[0];
  const mime = asset.mimeType ?? "";
  if (!SAVE_FORMAT[mime]) throw new Error("Only JPEG, PNG or WebP images are supported.");

  const stripped = await ImageManipulator.manipulateAsync(asset.uri, [], {
    compress: 0.9,
    format: SAVE_FORMAT[mime],
  });

  const info = await FileSystem.getInfoAsync(stripped.uri);
  const bytes = info.exists && typeof info.size === "number" ? info.size : (asset.fileSize ?? 0);
  if (bytes > MAX_BYTES) throw new Error("That image is too large (max 5 MB).");

  const data = await FileSystem.readAsStringAsync(stripped.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { media_type: mime, data };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd mobile && npx jest __tests__/lib/pickReferenceImage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json && npx eslint src/lib/pickReferenceImage.ts __tests__/lib/pickReferenceImage.test.ts
git add mobile/src/lib/pickReferenceImage.ts mobile/__tests__/lib/pickReferenceImage.test.ts
git commit -m "feat(posts): pickReferenceImage helper — EXIF-strip + base64 (FR-1b)"
```

---

### Task 6: Mobile client + hook — forward `image`

**Files:**
- Modify: `mobile/src/api/derivativesClient.ts`
- Modify: `mobile/src/hooks/useMakePost.ts`
- Test: `mobile/__tests__/api/derivativesClient.test.ts` (append or create) and `mobile/__tests__/hooks/useMakePost.test.tsx` (append)

**Interfaces:**
- Consumes: `ReferenceImage` shape `{ media_type, data }`.
- Produces: `MakePostRequest.image?: { media_type: string; data: string }`; `RunPostArgs.image?: {...}`.

- [ ] **Step 1: Write the failing test**

Append to the derivatives client test (create the file if absent, mirroring existing client tests — mock `fetch`):

```ts
test("makePost sends the image in the body when provided", async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({ platform: "linkedin", variants: [], provenance: "ai-generated" }),
  });
  (global as any).fetch = fetchMock;
  const { makePost } = await import("@/api/derivativesClient");
  await makePost({
    source_text: "s", platform: "linkedin", api_key: "sk-ant-x",
    image: { media_type: "image/png", data: "AAA" },
  });
  const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(sentBody.image).toEqual({ media_type: "image/png", data: "AAA" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npx jest __tests__/api/derivativesClient.test.ts`
Expected: FAIL — `image` not on `MakePostRequest` (tsc/type error or missing key).

- [ ] **Step 3: Implement**

`derivativesClient.ts` — add to `MakePostRequest`:

```ts
  image?: { media_type: string; data: string }; // optional reference (FR-1b) — transient, never stored
```

(The existing `body: JSON.stringify({ provider_id: "anthropic", ...req })` already forwards `image` since it spreads `req` — no send-path change needed.)

`useMakePost.ts` — add `image?: { media_type: string; data: string }` to `RunPostArgs`, destructure it in `run`, and forward it:

```ts
  const res = await makePost({
    source_text: sourceText,
    platform,
    ...(tone ? { tone } : {}),
    ...(image ? { image } : {}),
    api_key: apiKey,
    provider_id: "anthropic",
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd mobile && npx jest __tests__/api/derivativesClient.test.ts __tests__/hooks/useMakePost.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json
git add mobile/src/api/derivativesClient.ts mobile/src/hooks/useMakePost.ts mobile/__tests__/api/derivativesClient.test.ts mobile/__tests__/hooks/useMakePost.test.tsx
git commit -m "feat(posts): forward optional reference image through client + hook (FR-1b)"
```

---

### Task 7: Mobile — Posts screen picker UI + Help

**Files:**
- Modify: `mobile/app/(tabs)/posts.tsx`
- Modify: `mobile/src/help-content/topics.ts` (extend `make-a-post` topic body)
- Test: `mobile/__tests__/screens/posts.test.tsx` (append; create if absent)

**Interfaces:**
- Consumes: `pickReferenceImage` (Task 5); `run({ ..., image })` (Task 6).

- [ ] **Step 1: Write the failing test** (mock `pickReferenceImage`)

```tsx
jest.mock("@/lib/pickReferenceImage", () => ({
  pickReferenceImage: jest.fn(),
}));
import { pickReferenceImage } from "@/lib/pickReferenceImage";
// ...render PostsScreen, mock useMakePost's run...

test("attaching a reference image shows a thumbnail and passes it to run", async () => {
  (pickReferenceImage as jest.Mock).mockResolvedValue({ media_type: "image/png", data: "AAA" });
  const { getByLabelText, findByLabelText } = render(<PostsScreen />);
  fireEvent.press(getByLabelText("Add reference image"));
  await findByLabelText("Remove reference image"); // thumbnail + remove appeared
  // typing source + pressing Make posts forwards image
  fireEvent.changeText(getByLabelText("Source text"), "hello");
  fireEvent.press(getByLabelText("Make posts"));
  expect(runMock).toHaveBeenCalledWith(expect.objectContaining({
    image: { media_type: "image/png", data: "AAA" },
  }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && npx jest __tests__/screens/posts.test.tsx`
Expected: FAIL — no "Add reference image" control.

- [ ] **Step 3: Implement**

In `posts.tsx`:
- `import { Image } from "react-native";` (add to the RN import) and `import { pickReferenceImage } from "@/lib/pickReferenceImage";` and `import { Alert } from "@/lib/alert";`.
- State: `const [image, setImage] = useState<{ media_type: string; data: string } | null>(null);`
- Handler:

```tsx
  const onPickImage = useCallback(async () => {
    try {
      const picked = await pickReferenceImage();
      if (picked) setImage(picked);
    } catch (e) {
      Alert.alert("Could not add image", e instanceof Error ? e.message : "Try another image.");
    }
  }, []);
```

- Forward it: in `onGenerate`, add `...(image ? { image } : {})` to the `run({...})` args.
- UI (place after the Tone field, before the Make-posts button): a "Reference image (optional)" label + helper text *"The model takes cues from this — it won't copy it."*, an **Add reference image** Pressable when `image == null`, else a `<Image source={{ uri: 'data:' + image.media_type + ';base64,' + image.data }} style={styles.thumb} />` with a **Remove reference image** Pressable (`onPress={() => setImage(null)}`). Give both Pressables the exact `accessibilityLabel`s used in the test.

Add `thumb` style (e.g. `{ width: 96, height: 96, borderRadius: radius.md }`) and any button styles reusing the existing `colors`/`spacing`.

In `topics.ts`, extend the `make-a-post` topic body with one sentence: attaching an optional reference image steers style/tone — the model takes cues, it does not copy the image, and posts are still AI-generated.

- [ ] **Step 4: Run to verify it passes**

Run: `cd mobile && npx jest __tests__/screens/posts.test.tsx __tests__/help/coverage.test.ts`
Expected: PASS (Help coverage still green — no new FEATURES key).

- [ ] **Step 5: Full mobile gate + commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json && npx eslint app/\(tabs\)/posts.tsx src/help-content/topics.ts && npx jest
git add mobile/app/\(tabs\)/posts.tsx mobile/src/help-content/topics.ts mobile/__tests__/screens/posts.test.tsx
git commit -m "feat(posts): reference-image picker on Posts screen + Help (FR-1b)"
```

---

## Self-Review

**Spec coverage:**
- Backend `image` schema → Task 1 ✓; prompt guidance → Task 2 ✓; vision branch (Anthropic SDK, transient, LLMError re-raise) → Task 3 ✓; router forward + Anthropic-only 400 guard → Task 4 ✓.
- Mobile pick + EXIF-strip + base64 → Task 5 ✓; client + hook forward → Task 6 ✓; Posts UI thumbnail/remove + Help line → Task 7 ✓.
- Testing (image ok, non-anthropic 400, bad-json 502, key/data no-leak, picker cancel/unsupported, client body, screen thumbnail+forward, prompt has/lacks guidance) → covered across Tasks 1–7 ✓.
- Provenance stays `ai-generated` (Task 3 returns it; Help says so) ✓. No new FEATURES key (Task 7) ✓.

**Placeholder scan:** none — every step has concrete code / commands.

**Type consistency:** `ReferenceImage(media_type, data)` (Py) ↔ `{ media_type, data }` (TS) consistent across Tasks 1/3/5/6/7; `generate_post(..., image=...)` signature matches Task 3 def + Task 4 call; `pickReferenceImage(): Promise<{media_type,data}|null>` matches Task 6/7 usage.

**Out of scope (per spec):** audio/video refs, managed-vision entitlement, non-Anthropic vision, multiple images, seam extension — none introduced.
