# Audio Narration Derivative (P1-5 P4, audio-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `POST /api/v1/derivatives/audio` endpoint that turns a validated draft section (or pasted text) into a short narrated MP3 clip — script generation via the existing LLM seam, synthesis via a NEW separate TTS client — plus a Publish-tab "Audio" mode with an inline play/pause preview and download, mirroring the existing card/carousel/animated derivatives end-to-end.

**Architecture:** The pipeline mirrors `/animated` minus the compiler: `resolve key+source (_resolve_key_and_source, reused verbatim) → generate a speakable narration script (generate_narration, the LLM seam) → synthesize audio (synthesize_speech, a NEW httpx.AsyncClient TTS call — the LLM seam is chat-only) → base64 MP3 in the response`. The compiler (`render.py`) is untouched — audio is not a compiler render. TTS is a dormant-config external service exactly like B3's originality check (`backend/src/trust/originality.py`): a fixed vendor base URL from config (never request-supplied, no SSRF), only `TTS_CAPABLE` providers accepted, empty base URL = feature disabled. The key/provider come from the SAME managed/BYOK fork every other derivative already uses — this makes "managed audio is dormant until an ops decision configures `managed_openai_api_key`" fall out for free, with zero extra gating code, because `get_managed_key("openai")` is `None` by default. Mobile adds a fourth Publish mode (`audio`) reusing the existing source picker, a new `expo-audio`-backed native player (writes the base64 payload to a cache file first — native AVPlayer/ExoPlayer `data:` URI support is inconsistent, unlike `<img>`/`<Image>`) with a plain `<audio controls>` on web, and the existing mime-generic `downloadArtifact`.

**Tech Stack:** FastAPI + Pydantic (`backend/src/derivatives/*`), `wegofwd_llm` seam (`build_provider`/`generate_validated`/`parse_json_response`), a NEW `httpx.AsyncClient` TTS client (`backend/src/derivatives/tts.py`), `asyncpg` (`backend/src/billing/usage_repo.py` metering), pytest + `fakeredis`/real-Postgres (`backend/tests/`), React Native + Expo Router (`mobile/app/(tabs)/posts.tsx`), `expo-audio` (SDK-53 audio module, installed via `npx expo install expo-audio`), Jest + `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-08-18-audio-narration-derivative-p4-design.md`

## Global Constraints

- **D1 — audio only, no video.** Nothing in this plan touches video/ffmpeg/A-V muxing; that is a separate, later slice.
- **D2 — source = a validated section/draft.** Reuse `_resolve_key_and_source` (`backend/src/derivatives/router.py:62-153`) **verbatim** — do not change its internal logic. The only permitted edit to it is widening its type hint union to include `AudioRequest` (Task 2), since it is structurally identical to `CardRequest`/`CarouselRequest`/`AnimatedRequest`.
- **D3 — delivery = in-app play + download.** Native: write the base64 payload to a cache file (`expo-file-system`, the same technique `mobile/src/storage/epubLibrary.ts:75-79`'s native `downloadArtifact` path already uses) and play that `file://` URI via `expo-audio` — never a `data:` URI on native. Web: a plain `<audio controls>` element (browsers handle `data:` URIs for audio natively; no such native-player concern). Download uses the existing mime-generic `downloadArtifact` — no new download code.
- **D4 — TTS via a separate, dormant-config client.** `backend/src/derivatives/tts.py` is a NEW `httpx.AsyncClient` (the `wegofwd_llm` seam is chat-completions only, no TTS field on `Capabilities`). `TTS_CAPABLE = frozenset({"openai"})` — a non-TTS-capable or dormant (base-url-unset) provider gets a clean 422, checked BEFORE any key resolution or LLM call. The base URL is CONFIG (`settings.tts_base_url_openai`), never request-supplied (no SSRF).
- **Compiler — NO change.** `backend/src/derivatives/render.py` is not touched by any task in this plan. Audio is not a compiler render.
- **Launch posture:** BYOK-first. `AudioRequest.provider_id` defaults to `"openai"` (the only TTS-capable provider) — unlike the other derivatives, which default to `"anthropic"`. Managed audio is dormant until an ops decision sets `managed_openai_api_key`; until then the managed path returns the exact same clean 400 ("an api_key is required for this request") the other derivatives' managed fork already returns, with **zero new gating code** — proven in Task 2 by a test that monkeypatches nothing.
- **ADR-001: the LLM/BYOK/TTS key must NEVER be logged, persisted, or appear in a traceback.** Every task that touches a key includes a `caplog` assertion — mirroring `test_derivatives_generate.py`'s `assert _API_KEY not in caplog.text`. `synthesize_speech`'s `httpx` calls drop transport exceptions with `raise ... from None` (the same discipline `generate.py`'s `_generate_post_with_image` uses for the Anthropic SDK, since an attached `httpx.Request` carries the `Authorization` header).
- `asyncpg`/`aioredis`/`httpx.AsyncClient` only; no `backend/__init__.py`; run `ruff format` on every changed `.py` file before committing.
- **Metering:** managed spend is character-count-priced (not token-priced — TTS has no output-token concept), metered **once, on success only, managed path only** — mirrors `generate/tasks.py:153-186`'s `_record_managed_usage` best-effort discipline (never fails the request; a metering error is swallowed with a warning).
- **Mobile Help DoD:** a new user-facing "Generate narration" action gets a `FEATURES` key (`mobile/src/help-content/features.ts`), a Help topic with the matching `featureKey` (`mobile/src/help-content/topics.ts`), and a `HELP_TREE` leaf (`mobile/src/help-content/tree.ts`) in the SAME task — `mobile/__tests__/help/coverage.test.ts` and `mobile/__tests__/help/tree.test.ts` fail otherwise. Use `@/lib/alert`'s `Alert`, not `react-native`'s. Mock `expo-audio` in every Jest test that renders it.
- **Type/name consistency held across every task:** `generate_narration`, `NarrationContent`, `synthesize_speech`, `TTS_CAPABLE`, `is_tts_available`, `TTSError`/`TTSProviderNotSupported`, `AudioRequest`/`AudioResponse`, `makeAudio`/`MakeAudioRequest`/`MakeAudioResponse`, `useMakeAudio`, `AudioNarrationPlayer` — the same names are used verbatim wherever they recur below.
- **Non-goals (do not build):** A-V/video, a whole-book audiobook, reader-carried narration (the sandboxed-iframe reader has no audio pipeline), speech-to-text input, a second TTS vendor beyond OpenAI.

---

### Task 1: Backend TTS client + narration script (no endpoint yet)

**Files:**
- Create: `backend/src/derivatives/tts.py`
- Modify: `backend/config.py` (insert after line 179, `anthropic_default_model: str = Field(default="claude-sonnet-4-6")`)
- Modify: `backend/src/derivatives/schemas.py` (insert `NarrationContent` between `CardResponse` (ends line 157) and the `# --- Publish animated card (P1-5 P3) ---` comment at line 159)
- Modify: `backend/src/derivatives/prompt.py` (append `build_narration_prompt` after `build_carousel_prompt`, which ends line 102)
- Modify: `backend/src/derivatives/generate.py` (add `_NARRATION_MAX_TOKENS` near the other `_MAX_TOKENS` constants at lines 33-39; add `generate_narration` at the end of the file, after `generate_carousel` which ends line 195; extend the imports at lines 28-29)
- Test: `backend/tests/test_derivatives_narration.py`
- Test: `backend/tests/test_derivatives_tts.py`

**Interfaces:**
- Consumes: `wegofwd_llm.conformance.generate_validated`, `wegofwd_llm.contract.LLMRequest`, `wegofwd_llm.registry.build_provider` (existing, already imported in `generate.py`); `backend.src.generate.anthropic_caller.parse_json_response` (existing, already imported in `generate.py`); `backend.config.settings` (existing).
- Produces: `NarrationContent(BaseModel)` with fields `script: str`, `title: str` (`backend/src/derivatives/schemas.py`). `generate_narration(*, source_text: str, tone: str | None, provider_id: str, api_key: str, model: str) -> NarrationContent` (`backend/src/derivatives/generate.py`) — raises `LLMSchemaError` on repair-budget exhaustion, never logs `api_key`. `build_narration_prompt(source_text: str, tone: str | None) -> str` (`backend/src/derivatives/prompt.py`). `backend.src.derivatives.tts`: `TTS_CAPABLE: frozenset[str]`, `TTSError(Exception)`, `TTSProviderNotSupported(TTSError)`, `is_tts_available(provider_id: str) -> bool`, `async def synthesize_speech(script: str, *, provider_id: str, api_key: str, voice: str | None = None, fmt: str = "mp3") -> tuple[bytes, int]` (returns `(audio_bytes, char_count)`). `settings.tts_base_url_openai: str` (`backend/config.py`, default `"https://api.openai.com/v1"`; empty = disabled).

- [ ] **Step 1: Write the failing narration-script tests**

Create `backend/tests/test_derivatives_narration.py`:

```python
"""Tests for the audio-narration LLM-copy contract (P1-5 P4).

Covers `build_narration_prompt`'s speakable-prose instructions and
`generate_narration` returning the `NarrationContent` contract. Patches only
the provider seam (`build_provider`, via `helpers.fake_provider`) so the REAL
`generate_validated` + the real `_validate` closure
(`NarrationContent.model_validate(parse_json_response(...))`) run — same
discipline as `test_derivatives_card.py`. No TTS, no endpoint — those are
this same task's `tts.py` tests and Task 2's endpoint tests.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from wegofwd_llm import LLMSchemaError

from backend.src.derivatives import generate as gen
from backend.src.derivatives.prompt import build_narration_prompt
from backend.tests.helpers import fake_provider

_API_KEY = "sk-ant-xxxxxxxxxxxxxxxxxxxx"

_GOOD = json.dumps(
    {
        "title": "Stormwater, decoded",
        "script": "Water always finds the lowest point. That single idea explains most of what a stormwater system does.",
    }
)


def test_build_narration_prompt_asks_for_speakable_prose_and_strips_markup():
    prompt = build_narration_prompt("## Heading\n\nSome **bold** text. [1]", None)
    assert "no markdown" in prompt.lower()
    assert "no citation markers" in prompt.lower()
    assert "60-90" in prompt


def test_build_narration_prompt_includes_tone_when_given():
    with_tone = build_narration_prompt("src", "warm")
    without_tone = build_narration_prompt("src", None)
    assert "Tone: warm." in with_tone
    assert "Tone:" not in without_tone


def test_generate_narration_returns_contract_from_the_model(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        out = gen.generate_narration(
            source_text="Stormwater basics.",
            tone=None,
            provider_id="openai",
            api_key=_API_KEY,
            model="gpt-4o-mini",
        )
    assert out.title == "Stormwater, decoded"
    assert "lowest point" in out.script
    assert _API_KEY not in caplog.text


def test_generate_narration_repairs_then_succeeds(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(responses=["not json", _GOOD]),
    ):
        out = gen.generate_narration(
            source_text="src",
            tone="warm",
            provider_id="openai",
            api_key=_API_KEY,
            model="gpt-4o-mini",
        )
    assert out.title == "Stormwater, decoded"
    assert _API_KEY not in caplog.text


def test_generate_narration_raises_on_bad_output(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text="never json"),
    ):
        with pytest.raises(LLMSchemaError):
            gen.generate_narration(
                source_text="src",
                tone=None,
                provider_id="openai",
                api_key=_API_KEY,
                model="gpt-4o-mini",
            )
    assert _API_KEY not in caplog.text
```

- [ ] **Step 2: Run it — confirm it fails on missing symbols**

Run: `cd backend && python -m pytest tests/test_derivatives_narration.py -q`
Expected: FAIL — `ImportError: cannot import name 'build_narration_prompt'` (and `generate.generate_narration` doesn't exist yet).

- [ ] **Step 3: Add `NarrationContent`, `build_narration_prompt`, and `generate_narration`**

In `backend/src/derivatives/schemas.py`, insert immediately after `CardResponse` (which currently ends at line 157) and before the `# --- Publish animated card (P1-5 P3) ---` comment (line 159):

```python
class NarrationContent(BaseModel):
    """Shape the model's JSON response is validated against for the audio
    narration script (P1-5 P4) — a speakable rewrite of the source, not a
    promotional headline/subtext pair like `CardContent`."""

    title: str
    script: str
```

In `backend/src/derivatives/prompt.py`, append after `build_carousel_prompt` (which currently ends line 102):

```python


def build_narration_prompt(source_text: str, tone: str | None) -> str:
    """Return the prompt for generating a speakable audio-narration script.

    Output is JSON conforming to `schemas.NarrationContent`. Unlike the other
    derivative prompts (write ABOUT/promote the source), this REWRITES the
    source into natural spoken prose: strip markdown/headings/citation
    markers/bullet points, and produce a short narration a text-to-speech
    voice can read aloud without stumbling over syntax.
    """
    tone_line = f"Tone: {tone}.\n" if tone else ""
    return (
        "You are a narrator turning written material into a SPOKEN summary. Using ONLY the "
        "source material below, write natural, speakable prose that a text-to-speech voice "
        "can read aloud — no markdown, no headings, no bullet points, no citation markers "
        "like [1] or (Smith, 2020), no code blocks, no LaTeX. Write complete sentences a "
        "person would actually say out loud.\n"
        f"{tone_line}"
        "Target length: about 60-90 seconds of spoken narration (roughly 150-230 words). "
        "Do not invent facts beyond the source.\n"
        'Return ONLY JSON: {"title": string, "script": string}.\n'
        "title: <= 60 characters, a short label for this clip. script: the full spoken "
        "narration as plain prose (no line breaks needed).\n\n"
        f'SOURCE:\n"""\n{source_text}\n"""'
    )
```

In `backend/src/derivatives/generate.py`, change the imports at lines 28-29:

```python
from .prompt import build_card_prompt, build_carousel_prompt, build_derivative_prompt, build_narration_prompt
from .schemas import (
    CardContent,
    DerivativeResponse,
    NarrationContent,
    PostVariant,
    ReferenceImage,
    _DerivativeOutput,
)
```

Add a constant next to `_CAROUSEL_MAX_TOKENS` (line 39):

```python
# A ~60-90s spoken script (150-230 words) needs modest headroom — less than
# the carousel's multi-frame output, more than a single card's headline pair.
_NARRATION_MAX_TOKENS = 1024
```

Append at the end of the file, after `generate_carousel` (which currently ends line 195):

```python


def generate_narration(
    *, source_text: str, tone: str | None, provider_id: str, api_key: str, model: str
) -> NarrationContent:
    """Generate a speakable narration script + title for `source_text` (P1-5 P4).

    Mirrors `generate_card`'s text path: build a provider from the registry,
    issue a JSON-mode request, and validate + repair via `generate_validated`.
    Never logs `api_key`. Raises `LLMSchemaError` on repair-budget exhaustion
    (the router maps it to a 502 — Task 2).
    """
    prompt = build_narration_prompt(source_text, tone)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_NARRATION_MAX_TOKENS, response_format="json")

    def _validate(text: str) -> NarrationContent:
        return NarrationContent.model_validate(parse_json_response(text))

    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS).parsed
```

- [ ] **Step 4: Run it — confirm the narration tests pass**

Run: `cd backend && python -m pytest tests/test_derivatives_narration.py -q`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing TTS-client tests**

Create `backend/tests/test_derivatives_tts.py`:

```python
"""Tests for backend.src.derivatives.tts (P1-5 P4 — the audio narration TTS client).

The LLM seam (`wegofwd_llm`) is chat-completions only, so this is a NEW,
separate `httpx.AsyncClient` call to a vendor TTS endpoint (mirrors B3's
originality external-service situation) — patches httpx.AsyncClient directly,
never hits a live TTS vendor. ADR-001: the api_key travels ONLY in the
Authorization header and must never appear in a raised exception's message
or in captured logs.
"""

from __future__ import annotations

import logging

import httpx
import pytest

from backend.config import settings
from backend.src.derivatives.tts import (
    TTS_CAPABLE,
    TTSError,
    TTSProviderNotSupported,
    is_tts_available,
    synthesize_speech,
)

_API_KEY = "sk-TEST_FAKE_OPENAI_KEY_for_leak_detection_DO_NOT_REPLACE_xxxxxxxxxxxxxxxx"


class _FakeAsyncClient:
    """Stands in for httpx.AsyncClient as an async context manager."""

    def __init__(self, *, response=None, exc=None, capture=None, **init_kwargs):
        self._response = response
        self._exc = exc
        self._capture = capture
        if capture is not None:
            capture["init_kwargs"] = init_kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def post(self, path, **kwargs):
        if self._capture is not None:
            self._capture["path"] = path
            self._capture["post_kwargs"] = kwargs
        if self._exc is not None:
            raise self._exc
        return self._response


def test_tts_capable_lists_openai_only():
    assert TTS_CAPABLE == frozenset({"openai"})


def test_is_tts_available_true_for_openai_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "tts_base_url_openai", "https://api.openai.com/v1")
    assert is_tts_available("openai") is True


def test_is_tts_available_false_when_base_url_empty(monkeypatch):
    monkeypatch.setattr(settings, "tts_base_url_openai", "")
    assert is_tts_available("openai") is False


def test_is_tts_available_false_for_non_tts_provider():
    assert is_tts_available("anthropic") is False


async def test_synthesize_speech_posts_to_the_right_url_with_key_in_header(monkeypatch, caplog):
    monkeypatch.setattr(settings, "tts_base_url_openai", "https://api.openai.com/v1")
    capture: dict = {}
    fake_response = httpx.Response(200, content=b"ID3-fake-mp3-bytes")
    monkeypatch.setattr(
        "backend.src.derivatives.tts.httpx.AsyncClient",
        lambda **kw: _FakeAsyncClient(response=fake_response, capture=capture, **kw),
    )

    audio_bytes, char_count = await synthesize_speech(
        "Hello there.", provider_id="openai", api_key=_API_KEY, voice="alloy"
    )

    assert audio_bytes == b"ID3-fake-mp3-bytes"
    assert char_count == len("Hello there.")
    assert capture["path"] == "/audio/speech"
    assert capture["post_kwargs"]["headers"]["Authorization"] == f"Bearer {_API_KEY}"
    assert capture["post_kwargs"]["json"]["input"] == "Hello there."
    assert capture["post_kwargs"]["json"]["voice"] == "alloy"
    assert capture["init_kwargs"]["base_url"] == "https://api.openai.com/v1"
    assert _API_KEY not in caplog.text


async def test_synthesize_speech_raises_for_non_tts_provider():
    with pytest.raises(TTSProviderNotSupported):
        await synthesize_speech("x", provider_id="anthropic", api_key=_API_KEY, voice=None)


async def test_synthesize_speech_raises_when_dormant_config_disabled(monkeypatch):
    monkeypatch.setattr(settings, "tts_base_url_openai", "")
    with pytest.raises(TTSProviderNotSupported):
        await synthesize_speech("x", provider_id="openai", api_key=_API_KEY, voice=None)


async def test_synthesize_speech_raises_tts_error_on_non_2xx(monkeypatch):
    monkeypatch.setattr(settings, "tts_base_url_openai", "https://api.openai.com/v1")
    fake_response = httpx.Response(401, content=b"unauthorized")
    monkeypatch.setattr(
        "backend.src.derivatives.tts.httpx.AsyncClient",
        lambda **kw: _FakeAsyncClient(response=fake_response),
    )
    with pytest.raises(TTSError):
        await synthesize_speech("x", provider_id="openai", api_key=_API_KEY, voice=None)


async def test_synthesize_speech_key_never_leaks_on_transport_failure(monkeypatch, caplog):
    caplog.set_level(logging.WARNING)
    monkeypatch.setattr(settings, "tts_base_url_openai", "https://api.openai.com/v1")
    # A real httpx.Request carries the Authorization header — this is exactly
    # the leak risk the `from None` discipline in generate.py's
    # `_generate_post_with_image` guards against for the Anthropic SDK (ADR-001).
    req = httpx.Request(
        "POST",
        "https://api.openai.com/v1/audio/speech",
        headers={"Authorization": f"Bearer {_API_KEY}"},
    )
    exc = httpx.ConnectError("boom", request=req)
    monkeypatch.setattr(
        "backend.src.derivatives.tts.httpx.AsyncClient",
        lambda **kw: _FakeAsyncClient(exc=exc),
    )
    with pytest.raises(TTSError) as excinfo:
        await synthesize_speech("x", provider_id="openai", api_key=_API_KEY, voice=None)
    # The raised exception's own message must not carry the key — a caller
    # that logs str(exc) (the router does) must never leak it.
    assert _API_KEY not in str(excinfo.value)
    logging.getLogger("test").warning("tts failed: %s", excinfo.value)
    assert _API_KEY not in caplog.text
```

- [ ] **Step 6: Run it — confirm it fails on missing module**

Run: `cd backend && python -m pytest tests/test_derivatives_tts.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.src.derivatives.tts'`.

- [ ] **Step 7: Create `tts.py` and add the config gate**

In `backend/config.py`, insert immediately after line 179 (`anthropic_default_model: str = Field(default="claude-sonnet-4-6")`) and before the `# ── Artifact compiler (Node) ──` comment (line 181):

```python

    # ── Audio narration derivative TTS (P1-5 P4) ──────────────────────────────
    # The LLM seam is chat-completions only (no TTS field on Capabilities), so
    # text-to-speech is a SEPARATE, dormant-config httpx client (tts.py) — the
    # base URL is config, never request-supplied (no SSRF). Non-empty by
    # default so BYOK narration works out of the box at launch (D4/launch
    # posture); set to "" to kill-switch the whole /derivatives/audio endpoint
    # (it returns a clean 422 and the mobile button hides). The managed vendor
    # KEY is the existing `managed_openai_api_key` above — no new key config.
    tts_base_url_openai: str = Field(
        default="https://api.openai.com/v1",
        description="OpenAI TTS base URL; empty = audio narration disabled",
    )
```

Create `backend/src/derivatives/tts.py`:

```python
"""Text-to-speech client for the audio-narration derivative (P1-5 P4).

The LLM seam (`wegofwd_llm`) is chat-completions only — its `Capabilities`
has no TTS field — so turning a narration script into audio needs a NEW,
SEPARATE `httpx.AsyncClient` call to a vendor TTS endpoint, exactly like
B3's originality external-service situation
(`backend/src/trust/originality.py`). The base URL is CONFIG, never
request-supplied (no SSRF): only `TTS_CAPABLE` providers are accepted, and an
unconfigured (empty) base URL means the whole derivative is dormant.
`api_key` is the SAME managed/BYOK key `_resolve_key_and_source` already
resolved for the narration LLM call — it travels ONLY in the Authorization
header to the fixed vendor URL, and is NEVER logged (ADR-001).
"""

from __future__ import annotations

import httpx

from backend.config import settings

# The only vendor wired today. Adding a second (e.g. Gemini) is: add its
# base-url config field, add it to TTS_CAPABLE, and extend `_base_url_for`.
TTS_CAPABLE: frozenset[str] = frozenset({"openai"})

_OPENAI_TTS_MODEL = "tts-1"
_DEFAULT_VOICE = "alloy"
_TIMEOUT_SECONDS = 60.0


class TTSError(Exception):
    """Transport or vendor failure synthesizing audio. Never carries the key —
    only a status code or a generic transport message."""


class TTSProviderNotSupported(TTSError):
    """`provider_id` has no TTS endpoint: either it's not in `TTS_CAPABLE`, or
    the feature is dormant (its base-url config is unset)."""


def _base_url_for(provider_id: str) -> str:
    """OUR configured base URL for `provider_id`'s TTS endpoint, or "" if
    that provider has none configured (dormant)."""
    if provider_id == "openai":
        return settings.tts_base_url_openai
    return ""


def is_tts_available(provider_id: str) -> bool:
    """True iff `provider_id` is TTS-capable AND its base URL is configured
    (not dormant). Cheap, key-free, synchronous — the router calls this FIRST
    so an unsupported/disabled provider fails with a clean 422 before any LLM
    call or key resolution is attempted."""
    return provider_id in TTS_CAPABLE and bool(_base_url_for(provider_id))


async def synthesize_speech(
    script: str,
    *,
    provider_id: str,
    api_key: str,
    voice: str | None = None,
    fmt: str = "mp3",
) -> tuple[bytes, int]:
    """POST `script` to `provider_id`'s TTS endpoint. Returns
    `(audio_bytes, char_count)` — `char_count` is `len(script)`, for the
    caller to meter managed spend.

    Raises `TTSProviderNotSupported` for a non-TTS-capable or dormant
    (unconfigured) provider — checked BEFORE any network call. Raises
    `TTSError` on any transport failure or non-2xx vendor response. `api_key`
    is sent ONLY in the Authorization header to the fixed config base URL —
    never a user-controlled URL (no SSRF), never logged, never included in a
    raised exception's message (every `raise` below drops the underlying
    httpx exception with `from None`, mirroring generate.py's vision-call
    discipline — an attached httpx.Request carries the Authorization header
    and chaining it would let the key leak into a traceback, ADR-001).
    """
    if not is_tts_available(provider_id):
        raise TTSProviderNotSupported(f"{provider_id} does not support audio narration")

    base_url = _base_url_for(provider_id)
    char_count = len(script)
    async with httpx.AsyncClient(base_url=base_url, timeout=_TIMEOUT_SECONDS) as client:
        try:
            resp = await client.post(
                "/audio/speech",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": _OPENAI_TTS_MODEL,
                    "input": script,
                    "voice": voice or _DEFAULT_VOICE,
                    "response_format": fmt,
                },
            )
        except httpx.HTTPError:
            raise TTSError("audio synthesis request failed") from None

    if resp.status_code >= 400:
        raise TTSError(f"audio synthesis failed ({resp.status_code})")
    return resp.content, char_count
```

- [ ] **Step 8: Run both test files — confirm everything passes**

Run: `cd backend && python -m pytest tests/test_derivatives_tts.py tests/test_derivatives_narration.py -q`
Expected: PASS (14 tests total).

- [ ] **Step 9: Format and commit**

Run: `cd backend && ruff format config.py src/derivatives/tts.py src/derivatives/schemas.py src/derivatives/prompt.py src/derivatives/generate.py tests/test_derivatives_tts.py tests/test_derivatives_narration.py`

```bash
git add backend/config.py backend/src/derivatives/tts.py backend/src/derivatives/schemas.py \
  backend/src/derivatives/prompt.py backend/src/derivatives/generate.py \
  backend/tests/test_derivatives_tts.py backend/tests/test_derivatives_narration.py
git commit -m "feat(derivatives): narration script generator + dormant TTS client (P1-5 P4 T1)"
```

---

### Task 2: Backend `/api/v1/derivatives/audio` endpoint

**Files:**
- Modify: `backend/src/billing/pricing.py` (append `_TTS_PRICES` + `tts_cost_micros` after `cost_micros`, which currently ends line 47)
- Modify: `backend/src/derivatives/schemas.py` (append `AudioRequest`/`AudioResponse` at the end of the file, after `CarouselResponse`)
- Modify: `backend/src/derivatives/router.py` (imports; widen `_resolve_key_and_source`'s type hint at line 63; add `make_audio` at the end of the file, after `make_animated`)
- Test: `backend/tests/test_derivatives_audio_endpoint.py`

**Interfaces:**
- Consumes (from Task 1): `backend.src.derivatives.generate.generate_narration`, `backend.src.derivatives.tts.{TTS_CAPABLE, TTSError, TTSProviderNotSupported, is_tts_available, synthesize_speech}`.
- Consumes (existing): `backend.src.derivatives.router._resolve_key_and_source` (widened, not rewritten); `backend.src.billing.usage_repo.record_usage`; `backend.src.accounts.repo.get_or_create_account`; `wegofwd_llm.registry.PROVIDER_REGISTRY`.
- Produces: `AudioRequest(BaseModel)` — `source_text: str | None`, `topic_version_id: uuid.UUID | None`, `tone: str | None`, `voice: str | None`, `api_key: str | None`, `provider_id: str = "openai"`, `model: str | None` (exactly-one-source + known-provider validators, mirroring `CardRequest`). `AudioResponse(BaseModel)` — `script: str`, `title: str`, `audio_base64: str`, `mime: str = "audio/mpeg"`, `provenance: str = "ai-generated"`. `pricing.tts_cost_micros(provider_id: str, char_count: int) -> int`. `POST /api/v1/derivatives/audio` → `AudioResponse`.

- [ ] **Step 1: Write the failing endpoint tests**

Create `backend/tests/test_derivatives_audio_endpoint.py`:

```python
"""Endpoint tests for POST /api/v1/derivatives/audio (P1-5 P4).

Mirrors `test_derivatives_animated_endpoint.py`'s harness: the no-DB `client`
fixture for the BYOK/schema/managed-ineligible/TTS-gate paths, and a real-
Postgres `TestClient(app)` lifespan for the trust-section access gate + the
managed-entitlement fork + metering (none of `require_project_access`,
`resolve_managed_access`, or `usage_repo.record_usage` is stubbed).
`generate_narration`'s LLM call and `synthesize_speech`'s TTS call are always
stubbed — real generation is Task 1's concern.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import pytest
from fastapi.testclient import TestClient
from wegofwd_llm.registry import PROVIDER_REGISTRY

from backend.config import settings
from backend.main import app
from backend.src.accounts import repo as accounts_repo
from backend.src.accounts.deps import require_active_user
from backend.src.auth.deps import optional_user
from backend.src.auth.principal import Principal
from backend.src.billing import entitlement_repo, plans
from backend.src.trust import topic_repo
from backend.tests.helpers import fake_provider

pytestmark = pytest.mark.asyncio

_GOOD_NARRATION = json.dumps(
    {"title": "Stormwater, decoded", "script": "Water finds the lowest point."}
)
_AUDIO_BYTES = b"ID3-fake-mp3-bytes"
_BYOK_OPENAI_KEY = "sk-" + "x" * 20


async def test_source_text_ok_and_key_never_leaks(client, known_test_openai_key, caplog):
    with (
        patch(
            "backend.src.derivatives.generate.build_provider",
            return_value=fake_provider(text=_GOOD_NARRATION),
        ),
        patch(
            "backend.src.derivatives.router.synthesize_speech",
            AsyncMock(return_value=(_AUDIO_BYTES, 30)),
        ),
    ):
        r = await client.post(
            "/api/v1/derivatives/audio",
            json={"source_text": "Stormwater.", "api_key": known_test_openai_key},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Stormwater, decoded"
    assert body["script"] == "Water finds the lowest point."
    assert body["mime"] == "audio/mpeg"
    assert body["audio_base64"] == base64.b64encode(_AUDIO_BYTES).decode()
    assert body["provenance"] == "ai-generated"
    assert known_test_openai_key not in json.dumps(body)
    assert known_test_openai_key not in caplog.text


async def test_default_model_uses_provider_registry_default_not_anthropic(
    client, known_test_openai_key
):
    # `_resolve_key_and_source` falls back to settings.anthropic_default_model
    # when body.model is omitted, regardless of provider_id — wrong for a
    # non-Anthropic provider. make_audio must re-resolve the registry's OWN
    # default model for "openai" (gpt-4o-mini) when the caller pins none.
    mock_narration = MagicMock(return_value=SimpleNamespace(title="T", script="S"))
    with (
        patch("backend.src.derivatives.router.generate_narration", mock_narration),
        patch(
            "backend.src.derivatives.router.synthesize_speech",
            AsyncMock(return_value=(_AUDIO_BYTES, 1)),
        ),
    ):
        r = await client.post(
            "/api/v1/derivatives/audio",
            json={"source_text": "s", "api_key": known_test_openai_key},
        )
    assert r.status_code == 200, r.text
    assert mock_narration.call_args.kwargs["model"] == PROVIDER_REGISTRY["openai"].default_model


async def test_both_source_and_topic_version_422(client, known_test_openai_key):
    r = await client.post(
        "/api/v1/derivatives/audio",
        json={
            "source_text": "s",
            "topic_version_id": str(uuid.uuid4()),
            "api_key": known_test_openai_key,
        },
    )
    assert r.status_code == 422


async def test_neither_source_nor_topic_version_422(client, known_test_openai_key):
    r = await client.post("/api/v1/derivatives/audio", json={"api_key": known_test_openai_key})
    assert r.status_code == 422


async def test_malformed_topic_version_id_422(client, known_test_openai_key):
    r = await client.post(
        "/api/v1/derivatives/audio",
        json={"topic_version_id": "not-a-uuid", "api_key": known_test_openai_key},
    )
    assert r.status_code == 422


async def test_dormant_config_disabled_422(client, known_test_openai_key, monkeypatch):
    monkeypatch.setattr(settings, "tts_base_url_openai", "")
    r = await client.post(
        "/api/v1/derivatives/audio",
        json={"source_text": "s", "api_key": known_test_openai_key},
    )
    assert r.status_code == 422
    assert known_test_openai_key not in json.dumps(r.json())


async def test_non_tts_provider_422(client, known_test_api_key):
    r = await client.post(
        "/api/v1/derivatives/audio",
        json={"source_text": "s", "api_key": known_test_api_key, "provider_id": "anthropic"},
    )
    assert r.status_code == 422
    assert known_test_api_key not in json.dumps(r.json())


async def test_managed_ineligible_400(client):
    r = await client.post("/api/v1/derivatives/audio", json={"source_text": "s"})
    assert r.status_code == 400
    assert "sk-" not in json.dumps(r.json())


async def test_narration_bad_output_502(client, known_test_openai_key):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text="never json"),
    ):
        r = await client.post(
            "/api/v1/derivatives/audio",
            json={"source_text": "s", "api_key": known_test_openai_key},
        )
    assert r.status_code == 502
    assert known_test_openai_key not in json.dumps(r.json())


async def test_tts_failure_502(client, known_test_openai_key):
    from backend.src.derivatives.tts import TTSError

    with (
        patch(
            "backend.src.derivatives.generate.build_provider",
            return_value=fake_provider(text=_GOOD_NARRATION),
        ),
        patch(
            "backend.src.derivatives.router.synthesize_speech",
            AsyncMock(side_effect=TTSError("boom")),
        ),
    ):
        r = await client.post(
            "/api/v1/derivatives/audio",
            json={"source_text": "s", "api_key": known_test_openai_key},
        )
    assert r.status_code == 502
    assert known_test_openai_key not in json.dumps(r.json())


# ── HTTP: the trust-section seam + managed-entitlement fork + metering (real Postgres) ──
#
# Needs a real Postgres (local `mentible_test`; see conftest.py's DB-safety
# guard) because `require_project_access` / `resolve_managed_access` /
# `usage_repo.record_usage` read/write real rows — none is stubbed here.

DSN = os.environ.get("DATABASE_URL", "")
_managed_db = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set (no account DB)")


@pytest.fixture(autouse=True)
def _isolate_managed_db_state():
    prior = getattr(app.state, "db", None)
    app.state.db = None
    yield
    app.state.db = prior
    app.dependency_overrides.pop(optional_user, None)
    app.dependency_overrides.pop(require_active_user, None)


_SEEDED_ACCOUNTS: list[uuid.UUID] = []


@pytest.fixture(autouse=True)
def _purge_seeded_managed_rows():
    yield
    if not DSN or not _SEEDED_ACCOUNTS:
        _SEEDED_ACCOUNTS.clear()
        return

    async def _run() -> None:
        conn = await asyncpg.connect(DSN)
        try:
            for account_id in _SEEDED_ACCOUNTS:
                await conn.execute("DELETE FROM usage_event WHERE account_id = $1", account_id)
                await conn.execute("DELETE FROM entitlement WHERE account_id = $1", account_id)
                await conn.execute(
                    "DELETE FROM project_membership WHERE account_id = $1", account_id
                )
                await conn.execute("DELETE FROM project WHERE owner_account_id = $1", account_id)
                await conn.execute("DELETE FROM account WHERE id = $1", account_id)
        finally:
            await conn.close()

    asyncio.run(_run())
    _SEEDED_ACCOUNTS.clear()


def _principal(sub: str, email: str | None = None) -> Principal:
    return Principal(sub=sub, email=email, issuer="test")


def _seed_account_and_entitlement(*, sub: str, email: str, plan_id: str) -> uuid.UUID:
    async def _run() -> uuid.UUID:
        conn = await asyncpg.connect(DSN)
        try:
            acct = await accounts_repo.get_or_create_account(conn, idp_sub=sub, email=email)
            now = datetime.now(UTC)
            await entitlement_repo.set_entitlement(
                conn,
                account_id=acct.id,
                plan_id=plan_id,
                status="active",
                period_start=now - timedelta(days=1),
                period_end=now + timedelta(days=29),
            )
            return acct.id
        finally:
            await conn.close()

    account_id = asyncio.run(_run())
    _SEEDED_ACCOUNTS.append(account_id)
    return account_id


def _record_usage(account_id: uuid.UUID, *, cost_micros: int) -> None:
    from backend.src.billing import usage_repo

    async def _run() -> None:
        conn = await asyncpg.connect(DSN)
        try:
            await usage_repo.record_usage(
                conn,
                account_id=account_id,
                provider="openai",
                model="tts:alloy",
                input_tokens=0,
                output_tokens=100,
                cost_micros=cost_micros,
                job_id=uuid.uuid4(),
            )
        finally:
            await conn.close()

    asyncio.run(_run())


def _seed_project_with_reviewer(*, owner_sub: str, owner_email: str, reviewer_email: str) -> str:
    with TestClient(app) as c:
        app.dependency_overrides[require_active_user] = lambda: _principal(owner_sub, owner_email)
        pid = c.post("/api/v1/trust/projects", json={"title": "Stormwater"}).json()["id"]
        inv = c.post(
            f"/api/v1/trust/projects/{pid}/invitations",
            json={"email": reviewer_email, "role": "reviewer"},
        )
        assert inv.status_code == 200, inv.text

        reviewer_sub = f"rv-sub-{uuid.uuid4()}"
        app.dependency_overrides[require_active_user] = lambda: _principal(
            reviewer_sub, reviewer_email
        )
        redeemed = c.post("/api/v1/trust/session/sync")
        assert redeemed.status_code == 200, redeemed.text
    app.dependency_overrides.pop(require_active_user, None)

    owner_acct_id = asyncio.run(_get_account_id(owner_sub))
    _SEEDED_ACCOUNTS.append(owner_acct_id)
    reviewer_acct_id = asyncio.run(_get_account_id(reviewer_sub))
    _SEEDED_ACCOUNTS.append(reviewer_acct_id)
    return pid


async def _get_account_id(sub: str) -> uuid.UUID:
    conn = await asyncpg.connect(DSN)
    try:
        acct = await accounts_repo.get_account(conn, idp_sub=sub)
        return acct.id
    finally:
        await conn.close()


def _seed_topic_version(*, project_id: str, created_by_sub: str, cited: list[str]) -> str:
    async def _run() -> str:
        conn = await asyncpg.connect(DSN)
        try:
            sections = [
                {"heading": "Runoff basics", "body": "Water follows slope.", "source_ids": cited}
            ]
            tv = await topic_repo.create_topic_version(
                conn,
                project_id=uuid.UUID(project_id),
                topic_id="t1",
                title="Runoff",
                source_ids=cited or None,
                content={"sections": sections},
                created_by_sub=created_by_sub,
            )
            return str(tv.id)
        finally:
            await conn.close()

    return asyncio.run(_run())


async def _lookup_sub_for_email(email: str) -> str:
    conn = await asyncpg.connect(DSN)
    try:
        row = await conn.fetchrow("SELECT idp_sub FROM account WHERE email = $1", email)
        return row["idp_sub"]
    finally:
        await conn.close()


@_managed_db
def test_topic_version_non_member_403():
    owner_sub = f"o-{uuid.uuid4()}"
    owner_email = f"{owner_sub}@x.z"
    reviewer_email = f"rv-{uuid.uuid4()}@x.z"
    pid = _seed_project_with_reviewer(
        owner_sub=owner_sub, owner_email=owner_email, reviewer_email=reviewer_email
    )
    version_id = _seed_topic_version(project_id=pid, created_by_sub=owner_sub, cited=[])

    stranger_sub = f"stranger-{uuid.uuid4()}"
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(
            stranger_sub, f"{stranger_sub}@x.z"
        )
        try:
            r = c.post(
                "/api/v1/derivatives/audio",
                json={"topic_version_id": version_id, "api_key": _BYOK_OPENAI_KEY},
            )
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 403
    assert _BYOK_OPENAI_KEY not in json.dumps(r.json())


@_managed_db
def test_topic_version_missing_404():
    owner_sub = f"o-{uuid.uuid4()}"
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(owner_sub, f"{owner_sub}@x.z")
        try:
            r = c.post(
                "/api/v1/derivatives/audio",
                json={"topic_version_id": str(uuid.uuid4()), "api_key": _BYOK_OPENAI_KEY},
            )
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 404


@_managed_db
def test_topic_version_signed_out_401():
    with TestClient(app) as c:
        r = c.post(
            "/api/v1/derivatives/audio",
            json={"topic_version_id": str(uuid.uuid4()), "api_key": _BYOK_OPENAI_KEY},
        )
    assert r.status_code == 401


@_managed_db
def test_managed_dormant_by_default_400_no_monkeypatch():
    # No monkeypatch of settings.managed_openai_api_key at all — proves the
    # spec's launch posture (managed audio dormant until ops configures a
    # managed TTS key) holds with ZERO extra gating code: the SAME
    # `_resolve_key_and_source` managed fork the other derivatives use
    # already 400s here because get_managed_key("openai") is None.
    sub = f"none-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            r = c.post("/api/v1/derivatives/audio", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 400
    assert "api_key is required" in r.json()["detail"]


@_managed_db
def test_managed_entitlement_grants_access_not_400(monkeypatch):
    monkeypatch.setattr(settings, "managed_openai_api_key", "sk-" + "x" * 20)
    sub = f"ent-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    with TestClient(app) as c:
        _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_unlimited")
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            with (
                patch(
                    "backend.src.derivatives.generate.build_provider",
                    return_value=fake_provider(text=_GOOD_NARRATION),
                ),
                patch(
                    "backend.src.derivatives.router.synthesize_speech",
                    AsyncMock(return_value=(_AUDIO_BYTES, 30)),
                ),
            ):
                r = c.post("/api/v1/derivatives/audio", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code != 400


@_managed_db
def test_managed_over_cap_429(monkeypatch):
    monkeypatch.setattr(settings, "managed_openai_api_key", "sk-" + "x" * 20)
    sub = f"cap-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    account_id = _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_basic")
    allowance = plans.get_plan("managed_basic").allowance_micros
    _record_usage(account_id, cost_micros=allowance)
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            mock_narration = MagicMock()
            with patch("backend.src.derivatives.router.generate_narration", mock_narration):
                r = c.post("/api/v1/derivatives/audio", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 429
    mock_narration.assert_not_called()


@_managed_db
def test_managed_usage_metered_once_on_success(monkeypatch):
    monkeypatch.setattr(settings, "managed_openai_api_key", "sk-" + "x" * 20)
    sub = f"meter-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    account_id = _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_unlimited")
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            with (
                patch(
                    "backend.src.derivatives.generate.build_provider",
                    return_value=fake_provider(text=_GOOD_NARRATION),
                ),
                patch(
                    "backend.src.derivatives.router.synthesize_speech",
                    AsyncMock(return_value=(_AUDIO_BYTES, 42)),
                ),
            ):
                r = c.post("/api/v1/derivatives/audio", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 200, r.text

    async def _count() -> tuple[int, int]:
        conn = await asyncpg.connect(DSN)
        try:
            row = await conn.fetchrow(
                "SELECT count(*) AS n, coalesce(sum(output_tokens), 0) AS chars"
                " FROM usage_event WHERE account_id = $1 AND provider = 'openai'",
                account_id,
            )
            return row["n"], row["chars"]
        finally:
            await conn.close()

    count, chars = asyncio.run(_count())
    assert count == 1
    assert chars == 42


@_managed_db
def test_managed_usage_not_recorded_on_tts_failure(monkeypatch):
    from backend.src.derivatives.tts import TTSError

    monkeypatch.setattr(settings, "managed_openai_api_key", "sk-" + "x" * 20)
    sub = f"meterfail-{uuid.uuid4()}"
    email = f"{sub}@x.z"
    account_id = _seed_account_and_entitlement(sub=sub, email=email, plan_id="managed_unlimited")
    with TestClient(app) as c:
        app.dependency_overrides[optional_user] = lambda: _principal(sub, email)
        try:
            with (
                patch(
                    "backend.src.derivatives.generate.build_provider",
                    return_value=fake_provider(text=_GOOD_NARRATION),
                ),
                patch(
                    "backend.src.derivatives.router.synthesize_speech",
                    AsyncMock(side_effect=TTSError("boom")),
                ),
            ):
                r = c.post("/api/v1/derivatives/audio", json={"source_text": "s"})
        finally:
            app.dependency_overrides.pop(optional_user, None)
    assert r.status_code == 502

    async def _count() -> int:
        conn = await asyncpg.connect(DSN)
        try:
            return await conn.fetchval(
                "SELECT count(*) FROM usage_event WHERE account_id = $1", account_id
            )
        finally:
            await conn.close()

    assert asyncio.run(_count()) == 0
```

- [ ] **Step 2: Run it — confirm it fails on missing symbols**

Run: `cd backend && python -m pytest tests/test_derivatives_audio_endpoint.py -q`
Expected: FAIL — `ImportError`/404s, `AudioRequest`/`AudioResponse`/`make_audio` don't exist yet.

- [ ] **Step 3: Add TTS pricing, `AudioRequest`/`AudioResponse`, and `make_audio`**

In `backend/src/billing/pricing.py`, append after `cost_micros` (which currently ends line 47):

```python


# TTS is priced per INPUT CHARACTER, not per input/output token pair — there
# is no "output tokens" concept for a speech-synthesis call. USD per
# 1,000,000 characters.
_TTS_PRICES: dict[str, float] = {
    # OpenAI tts-1: $15.00 / 1M characters (verify on update — O6).
    "openai": 15.0,
}
_TTS_DEFAULT_RATE = 15.0


def tts_cost_micros(provider_id: str, char_count: int) -> int:
    """Estimated cost of a TTS synthesis call in micro-USD (1e-6 USD),
    rounded to the nearest micro. Same reduction as `cost_micros`: rate is
    per 1M characters, so cost_micros = char_count × rate."""
    rate = _TTS_PRICES.get(provider_id, _TTS_DEFAULT_RATE)
    return round(char_count * rate)
```

In `backend/src/derivatives/schemas.py`, append at the end of the file (after `CarouselResponse`):

```python


# --- Publish narrated audio (P1-5 P4) ---------------------------------------


class AudioRequest(BaseModel):
    """Body of POST /derivatives/audio — generate a narrated audio clip.

    Same `api_key` custody discipline as `CardRequest` (ADR-001): never
    logged, never persisted in plaintext. Exactly one of `source_text` /
    `topic_version_id` must be supplied, mirroring `CardRequest`. Unlike the
    other derivatives, `provider_id` defaults to "openai" — the only
    TTS-capable provider at launch (`tts.TTS_CAPABLE`); "anthropic" has no
    TTS endpoint and would fail the router's `is_tts_available` gate.
    """

    source_text: str | None = Field(default=None, min_length=1, max_length=20000)
    topic_version_id: uuid.UUID | None = None
    tone: str | None = None
    voice: str | None = None
    api_key: str | None = Field(default=None, min_length=20, max_length=512)
    provider_id: str = "openai"
    model: str | None = None

    @field_validator("provider_id")
    @classmethod
    def _known_provider(cls, v: str) -> str:
        if v not in PROVIDER_REGISTRY:
            raise ValueError(f"unknown provider_id {v!r}")
        return v

    @model_validator(mode="after")
    def _exactly_one_source(self) -> AudioRequest:
        if bool(self.source_text) == bool(self.topic_version_id):
            raise ValueError("provide exactly one of source_text or topic_version_id")
        return self


class AudioResponse(BaseModel):
    """Body of a completed audio-narration generation."""

    script: str
    title: str
    audio_base64: str
    mime: str = "audio/mpeg"
    provenance: str = "ai-generated"
```

In `backend/src/derivatives/router.py`, widen the type hint at line 63 (the `_resolve_key_and_source` signature — internal logic is UNCHANGED):

```python
async def _resolve_key_and_source(
    body: CardRequest | CarouselRequest | AnimatedRequest | AudioRequest,
    request: Request,
    principal: Principal | None,
) -> tuple[str, str, str, str | None]:
```

Extend the imports at the top of `router.py`. Add `from wegofwd_llm.registry import PROVIDER_REGISTRY` after the existing `wegofwd_llm.errors` import (lines 20-25); change `from backend.src.billing import access` (line 31) to:

```python
from backend.src.billing import access, pricing, usage_repo
```

Change the `generate` import (line 36) to:

```python
from backend.src.derivatives.generate import (
    generate_card,
    generate_carousel,
    generate_narration,
    generate_post,
)
```

Change the `schemas` import (lines 43-54) to add `AudioRequest, AudioResponse`:

```python
from backend.src.derivatives.schemas import (
    AnimatedRequest,
    AnimatedResponse,
    AudioRequest,
    AudioResponse,
    CardContent,
    CardRequest,
    CardResponse,
    CarouselFrame,
    CarouselRequest,
    CarouselResponse,
    DerivativeRequest,
    DerivativeResponse,
)
```

Add after the `render` import (line 37-42):

```python
from backend.src.derivatives.tts import (
    TTSError,
    TTSProviderNotSupported,
    is_tts_available,
    synthesize_speech,
)
```

Append at the end of the file, after `make_animated`:

```python


@router.post(
    "/audio",
    response_model=AudioResponse,
    dependencies=[Depends(enforce_rate_limit)],
)
async def make_audio(
    body: AudioRequest,
    request: Request,
    principal: Principal | None = Depends(optional_user),
) -> AudioResponse:
    """Generate a narrated audio clip (a spoken-summary script + MP3 render).

    Pipeline mirrors `make_card` minus the compiler: resolve key/source via
    `_resolve_key_and_source` (identical managed/BYOK fork + trust-section
    access gate), generate a speakable narration script via the LLM seam
    (`generate_narration`), then synthesize it via a SEPARATE TTS client
    (`synthesize_speech` — the LLM seam is chat-only, no TTS capability).

    `body.provider_id` must be TTS-capable AND the feature must be
    configured (`is_tts_available`) — checked FIRST, before any key
    resolution or LLM call, so an unsupported/disabled provider fails fast
    with a clean 422 and no wasted spend. Managed spend (character count ->
    cost) is metered once, on success only, on the managed path.

    Never logs `api_key` or the script content.
    """
    if not is_tts_available(body.provider_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"audio narration is not available for {body.provider_id}",
        )

    api_key, model, source_text, _source_label = await _resolve_key_and_source(
        body, request, principal
    )
    # _resolve_key_and_source falls back to settings.anthropic_default_model
    # when body.model is omitted, regardless of provider_id — wrong here
    # since AudioRequest defaults to the TTS-only "openai" provider. Re-
    # resolve the registry's OWN default model when the caller pinned none.
    if body.model is None and body.provider_id != "anthropic":
        model = PROVIDER_REGISTRY[body.provider_id].default_model

    try:
        narration = await asyncio.to_thread(
            generate_narration,
            source_text=source_text,
            tone=body.tone,
            provider_id=body.provider_id,
            api_key=api_key,
            model=model,
        )
    except LLMSchemaError:
        log.warning("audio_validation_failed", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="could not generate the narration script",
        ) from None
    except LLMAuthError:
        log.warning("audio_auth_rejected", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Your API key was rejected by the provider. Check it in Settings — "
                "it may be invalid, revoked, or out of credit."
            ),
        ) from None
    except LLMRateLimitError:
        log.warning("audio_rate_limited", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="The provider is rate-limiting requests. Wait a moment and try again.",
        ) from None
    except LLMError:
        log.warning("audio_llm_error", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="narration generation failed",
        ) from None
    except Exception:
        # Defense in depth: never let a raw exception escape with key material
        # to the framework logger. Type-only log, generic 502.
        log.warning("audio_unexpected_error", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="narration generation failed",
        ) from None

    try:
        audio_bytes, char_count = await synthesize_speech(
            narration.script,
            provider_id=body.provider_id,
            api_key=api_key,
            voice=body.voice,
        )
    except TTSProviderNotSupported:
        log.warning("audio_tts_not_supported", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"audio narration is not available for {body.provider_id}",
        ) from None
    except TTSError:
        log.warning("audio_tts_failed", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="could not synthesize audio",
        ) from None

    # Meter managed spend (char_count -> cost) on success only, managed path
    # only — best-effort, mirrors generate/tasks.py's _record_managed_usage.
    if body.api_key is None:
        db_pool = getattr(request.app.state, "db", None)
        if db_pool is not None and principal is not None:
            try:
                async with db_pool.acquire() as conn:
                    account = await accounts_repo.get_or_create_account(
                        conn, idp_sub=principal.sub, email=principal.email
                    )
                    cost = pricing.tts_cost_micros(body.provider_id, char_count)
                    await usage_repo.record_usage(
                        conn,
                        account_id=account.id,
                        provider=body.provider_id,
                        model=f"tts:{body.voice or 'default'}",
                        input_tokens=0,
                        output_tokens=char_count,
                        cost_micros=cost,
                        job_id=uuid.uuid4(),
                    )
                log.info("audio_usage_recorded", cost_micros=cost)
            except Exception:
                # Counts/cost only — no key, no content — so a warning is
                # safe, and metering never fails a clip the user already got.
                log.warning("audio_usage_record_failed")

    return AudioResponse(
        script=narration.script,
        title=narration.title,
        audio_base64=base64.b64encode(audio_bytes).decode(),
        mime="audio/mpeg",
        provenance="ai-generated",
    )
```

- [ ] **Step 4: Run the new endpoint tests — confirm they pass**

Run: `cd backend && python -m pytest tests/test_derivatives_audio_endpoint.py -q`
Expected: PASS. (The `@_managed_db` tests run only when `DATABASE_URL` is set to a local test DB — see `backend/tests/conftest.py`'s DB-safety guard; they skip otherwise.)

- [ ] **Step 5: Run the full derivatives regression suite**

Run: `cd backend && python -m pytest tests -q -k "derivativ"`
Expected: PASS — no regression in `/post`, `/card`, `/carousel`, `/animated`.

- [ ] **Step 6: Format and commit**

Run: `cd backend && ruff format src/billing/pricing.py src/derivatives/schemas.py src/derivatives/router.py tests/test_derivatives_audio_endpoint.py`

```bash
git add backend/src/billing/pricing.py backend/src/derivatives/schemas.py \
  backend/src/derivatives/router.py backend/tests/test_derivatives_audio_endpoint.py
git commit -m "feat(derivatives): POST /api/v1/derivatives/audio endpoint (P1-5 P4 T2)"
```

---

### Task 3: Mobile audio client + hook

**Files:**
- Modify: `mobile/src/api/derivativesClient.ts` (append after `makeAnimated`, which currently ends line 182)
- Create: `mobile/src/hooks/useMakeAudio.ts`
- Modify: `mobile/__tests__/api/derivativesClient.test.ts` (append tests)
- Test: `mobile/__tests__/hooks/useMakeAudio.test.ts`

**Interfaces:**
- Consumes: `ApiError`/`resolveBaseUrl` (`mobile/src/api/client.ts`, existing); `IS_DEMO` (`mobile/src/constants/demo.ts`, existing); `useBillingPlan` (`mobile/src/hooks/useBillingPlan.ts`, existing).
- Produces: `MakeAudioRequest { source_text?: string; topic_version_id?: string; tone?: string; voice?: string; api_key?: string; provider_id?: string; model?: string }`, `MakeAudioResponse { script: string; title: string; audio_base64: string; mime: string; provenance: string }`, `makeAudio(req: MakeAudioRequest): Promise<MakeAudioResponse>` (`mobile/src/api/derivativesClient.ts`). `useMakeAudio({ getApiKey }): { status, error, result, run, reset }` with `RunAudioArgs { source_text?, topic_version_id?, tone?, voice? }` (`mobile/src/hooks/useMakeAudio.ts`) — consumed by Task 4's `posts.tsx`.

- [ ] **Step 1: Write the failing `makeAudio` client tests**

In `mobile/__tests__/api/derivativesClient.test.ts`, change the import at line 1 to add `makeAudio`:

```ts
import { makeAudio, makeCard, makeCarousel, makePost } from "@/api/derivativesClient";
```

Append at the end of the file:

```ts

const AUDIO_RESPONSE = {
  script: "Water finds the lowest point.",
  title: "Stormwater, decoded",
  audio_base64: "SUQzZmFrZQ==",
  mime: "audio/mpeg",
  provenance: "ai-generated",
};

it("POSTs to /derivatives/audio with the exact body and returns the parsed response", async () => {
  mockFetchOnce(200, AUDIO_RESPONSE);
  const out = await makeAudio({
    source_text: "Stormwater basics.",
    tone: "warm",
    api_key: "sk-xxxxxxxxxxxxxxxxxxxx",
    provider_id: "openai",
  });
  expect(out.title).toBe("Stormwater, decoded");
  expect(out.mime).toBe("audio/mpeg");
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/derivatives\/audio$/);
  expect(init.method).toBe("POST");
  const sent = JSON.parse(init.body);
  expect(sent.source_text).toBe("Stormwater basics.");
  expect(sent.tone).toBe("warm");
  expect(sent.provider_id).toBe("openai");
  expect(sent.api_key).toBe("sk-xxxxxxxxxxxxxxxxxxxx");
});

it("makeAudio defaults provider_id to openai when omitted", async () => {
  mockFetchOnce(200, AUDIO_RESPONSE);
  await makeAudio({ source_text: "x", api_key: "sk-xxxxxxxxxxxxxxxxxxxx" });
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(init.body).provider_id).toBe("openai");
});

it("makeAudio sends topic_version_id instead of source_text when given", async () => {
  mockFetchOnce(200, AUDIO_RESPONSE);
  await makeAudio({ topic_version_id: "tv-1", api_key: "sk-x" });
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [, init] = fetchMock.mock.calls[0];
  const sent = JSON.parse(init.body);
  expect(sent.topic_version_id).toBe("tv-1");
  expect("source_text" in sent).toBe(false);
});

it("makeAudio throws ApiError on a non-2xx response", async () => {
  mockFetchOnce(422, { detail: "audio narration is not available for anthropic" });
  await expect(
    makeAudio({ source_text: "x", api_key: "sk-x" }),
  ).rejects.toBeInstanceOf(ApiError);
});

it("makeAudio throws in a demo build without hitting the network", async () => {
  jest.resetModules();
  jest.doMock("@/constants/demo", () => ({ IS_DEMO: true }));
  const fetchMock = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  const { makeAudio: demoMakeAudio } = await import("@/api/derivativesClient");
  await expect(demoMakeAudio({ source_text: "x" })).rejects.toThrow(/demo/i);
  expect(fetchMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it — confirm it fails on the missing export**

Run: `cd mobile && npx jest __tests__/api/derivativesClient.test.ts`
Expected: FAIL — `makeAudio` is not exported by `@/api/derivativesClient`.

- [ ] **Step 3: Implement `makeAudio` in `derivativesClient.ts`**

Append at the end of `mobile/src/api/derivativesClient.ts` (after `makeAnimated`, which currently ends line 182):

```ts

export interface MakeAudioResponse {
  script: string;
  title: string;
  audio_base64: string;
  mime: string;
  provenance: string;
}

export interface MakeAudioRequest {
  // Exactly one of source_text / topic_version_id — the caller (the Publish
  // screen's audio mode) enforces that, this module just forwards it.
  source_text?: string;
  topic_version_id?: string;
  tone?: string;
  voice?: string;
  // Omit entirely (never send "") for a keyless managed-plan request — the
  // backend resolves the vendor key from the caller's entitlement instead.
  // Present = BYOK, passed through per-request (never logged/stored).
  api_key?: string;
  provider_id?: string; // default "openai" — the only TTS-capable provider at launch
  model?: string;
}

// Turn source text (or a validated topic-version's content) into a narrated
// audio clip (P1-5 P4). Synchronous endpoint, mirrors makeCard. Key-free
// client shape (no JWT) — the caller populates api_key in the request; this
// module never reads or stores it.
export async function makeAudio(req: MakeAudioRequest): Promise<MakeAudioResponse> {
  // A demo build has no backend; the Publish tab is hidden there, but never
  // let a request leave the device regardless (mirrors makeCard).
  if (IS_DEMO) throw new Error("Making narration is disabled in this demo build.");
  const res = await fetch(`${resolveBaseUrl()}/api/v1/derivatives/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_id: "openai", ...req }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<MakeAudioResponse>;
}
```

- [ ] **Step 4: Run it — confirm the client tests pass**

Run: `cd mobile && npx jest __tests__/api/derivativesClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `useMakeAudio` tests**

Create `mobile/__tests__/hooks/useMakeAudio.test.ts`:

```ts
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useMakeAudio } from "@/hooks/useMakeAudio";
import { ApiError } from "@/api/client";
import * as client from "@/api/derivativesClient";
import { useBillingPlan } from "@/hooks/useBillingPlan";

jest.mock("@/api/derivativesClient", () => ({ makeAudio: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: jest.fn() }));
const makeAudio = client.makeAudio as jest.Mock;

const AUDIO_RESULT = {
  script: "Water finds the lowest point.",
  title: "Stormwater, decoded",
  audio_base64: "SUQzZmFrZQ==",
  mime: "audio/mpeg",
  provenance: "ai-generated",
};

beforeEach(() => {
  jest.clearAllMocks();
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: false });
});

it("sends the key, source text, tone and voice, then exposes the result on success", async () => {
  makeAudio.mockResolvedValue(AUDIO_RESULT);
  const getApiKey = jest.fn().mockResolvedValue("sk-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeAudio({ getApiKey }));

  await act(async () => {
    await result.current.run({ source_text: "Stormwater.", tone: "warm", voice: "nova" });
  });

  expect(makeAudio).toHaveBeenCalledWith(
    expect.objectContaining({
      source_text: "Stormwater.",
      tone: "warm",
      voice: "nova",
      api_key: "sk-xxxxxxxxxxxxxxxxxxxx",
      provider_id: "openai",
    }),
  );
  await waitFor(() => expect(result.current.status).toBe("done"));
  expect(result.current.result).toEqual(AUDIO_RESULT);
});

it("sends topic_version_id instead of source_text when given", async () => {
  makeAudio.mockResolvedValue(AUDIO_RESULT);
  const getApiKey = jest.fn().mockResolvedValue("sk-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeAudio({ getApiKey }));

  await act(async () => {
    await result.current.run({ topic_version_id: "tv-1" });
  });

  const sent = makeAudio.mock.calls[0][0];
  expect(sent.topic_version_id).toBe("tv-1");
  expect("source_text" in sent).toBe(false);
});

it("fails without calling makeAudio when no key is saved and known not-Pro", async () => {
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
  const getApiKey = jest.fn().mockResolvedValue(null);
  const { result } = renderHook(() => useMakeAudio({ getApiKey }));
  await act(async () => {
    await result.current.run({ source_text: "x" });
  });
  expect(makeAudio).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toMatch(/openai/i);
});

describe("keyless-when-Pro wiring", () => {
  it("no saved key + Pro sends a keyless request (no api_key) and sets no error", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: true }, loading: false });
    makeAudio.mockResolvedValue(AUDIO_RESULT);
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakeAudio({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater." });
    });

    expect(makeAudio).toHaveBeenCalledTimes(1);
    const sent = makeAudio.mock.calls[0][0];
    expect("api_key" in sent).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.error).toBeNull();
  });

  it("no saved key + plan still loading (null) sends a keyless request (fail-open)", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: true });
    makeAudio.mockResolvedValue(AUDIO_RESULT);
    const getApiKey = jest.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMakeAudio({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater." });
    });

    expect(makeAudio).toHaveBeenCalledTimes(1);
    expect("api_key" in makeAudio.mock.calls[0][0]).toBe(false);
  });

  it("a saved key is always sent as BYOK, regardless of plan", async () => {
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
    makeAudio.mockResolvedValue(AUDIO_RESULT);
    const getApiKey = jest.fn().mockResolvedValue("sk-xxxxxxxxxxxxxxxxxxxx");
    const { result } = renderHook(() => useMakeAudio({ getApiKey }));

    await act(async () => {
      await result.current.run({ source_text: "Stormwater." });
    });

    expect(makeAudio.mock.calls[0][0].api_key).toBe("sk-xxxxxxxxxxxxxxxxxxxx");
  });
});

it("surfaces ApiError.userMessage on failure", async () => {
  makeAudio.mockRejectedValue(
    new ApiError(422, JSON.stringify({ detail: "audio narration is not available for anthropic" })),
  );
  const getApiKey = jest.fn().mockResolvedValue("sk-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakeAudio({ getApiKey }));
  await act(async () => {
    await result.current.run({ source_text: "x" });
  });
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toBe("audio narration is not available for anthropic");
});
```

- [ ] **Step 6: Run it — confirm it fails on the missing module**

Run: `cd mobile && npx jest __tests__/hooks/useMakeAudio.test.ts`
Expected: FAIL — `Cannot find module '@/hooks/useMakeAudio'`.

- [ ] **Step 7: Implement `useMakeAudio`**

Create `mobile/src/hooks/useMakeAudio.ts`:

```ts
import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { makeAudio, type MakeAudioResponse } from "@/api/derivativesClient";
import { useBillingPlan } from "@/hooks/useBillingPlan";

export type MakeAudioStatus = "idle" | "generating" | "done" | "failed";

interface UseMakeAudioArgs {
  // Resolve the BYOK key lazily so it is read at run time, never held in state.
  getApiKey: () => Promise<string | null>;
}

// Exactly one of source_text / topic_version_id — the caller (the Publish
// screen's audio mode) enforces that, this hook just forwards it.
export interface RunAudioArgs {
  source_text?: string;
  topic_version_id?: string;
  tone?: string;
  voice?: string;
}

export interface UseMakeAudioResult {
  status: MakeAudioStatus;
  error: string | null;
  result: MakeAudioResponse | null;
  run: (args: RunAudioArgs) => Promise<void>;
  reset: () => void;
}

// Stateless one-shot: source text OR a validated topic-version -> one
// narrated audio clip over the synchronous /derivatives/audio endpoint (no
// polling). A Pro plan's managed key covers the vendor call, so a missing
// BYOK key only blocks Free/unknown-plan users — mirrors useMakeAnimated's
// guard exactly. Always sends provider_id "openai" — the only TTS-capable
// provider at launch (backend tts.TTS_CAPABLE).
export function useMakeAudio({ getApiKey }: UseMakeAudioArgs): UseMakeAudioResult {
  const [status, setStatus] = useState<MakeAudioStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MakeAudioResponse | null>(null);

  // Fail-open: while the plan is loading (plan == null) or Pro, a no-key run
  // goes keyless and the backend decides.
  const { plan } = useBillingPlan();
  const knownNotPro = plan != null && plan.is_pro === false;

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setResult(null);
  }, []);

  const run = useCallback(
    async ({ source_text, topic_version_id, tone, voice }: RunAudioArgs): Promise<void> => {
      setError(null);
      setStatus("generating");

      const apiKey = await getApiKey();
      if (!apiKey && knownNotPro) {
        setError("No API key saved. Go to Settings and paste your OpenAI key.");
        setStatus("failed");
        return;
      }

      try {
        const res = await makeAudio({
          ...(topic_version_id ? { topic_version_id } : { source_text }),
          ...(tone ? { tone } : {}),
          ...(voice ? { voice } : {}),
          // Never send api_key: "" — omit the field entirely for a keyless
          // (managed-plan) request.
          ...(apiKey ? { api_key: apiKey } : {}),
          provider_id: "openai",
        });
        setResult(res);
        setStatus("done");
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.userMessage()
            : err instanceof Error
              ? err.message
              : "Could not make narration.",
        );
        setStatus("failed");
      }
    },
    [getApiKey, knownNotPro],
  );

  return { status, error, result, run, reset };
}
```

- [ ] **Step 8: Run it — confirm the hook tests pass**

Run: `cd mobile && npx jest __tests__/hooks/useMakeAudio.test.ts __tests__/api/derivativesClient.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
cd mobile
git add src/api/derivativesClient.ts src/hooks/useMakeAudio.ts \
  __tests__/api/derivativesClient.test.ts __tests__/hooks/useMakeAudio.test.ts
git commit -m "feat(mobile): makeAudio client + useMakeAudio hook (P1-5 P4 T3)"
```

---

### Task 4: Mobile audio mode + player + Help

**Files:**
- Modify: `mobile/package.json` (via `npx expo install expo-audio`, not a manual edit)
- Create: `mobile/src/components/AudioNarrationPlayer.tsx` (native)
- Create: `mobile/src/components/AudioNarrationPlayer.web.tsx` (web)
- Test: `mobile/__tests__/components/AudioNarrationPlayer.test.tsx`
- Modify: `mobile/app/(tabs)/posts.tsx`
- Test: `mobile/__tests__/screens/Publish.audio.test.tsx`
- Modify: `mobile/src/help-content/features.ts` (insert after line 19, `publish-animated`)
- Modify: `mobile/src/help-content/topics.ts` (insert after the `publish-animated` topic, which currently ends line 604)
- Modify: `mobile/src/help-content/tree.ts` (insert after line 90, `leaf-publish-animated`; also update the `share-shortform` blurb at line 85)

**Interfaces:**
- Consumes (from Task 3): `useMakeAudio` (`mobile/src/hooks/useMakeAudio.ts`), `MakeAudioResponse` (`mobile/src/api/derivativesClient.ts`).
- Consumes (existing): `downloadArtifact` (`mobile/src/storage/epubLibrary.ts`), `fromBase64` (`mobile/src/storage/pickBookFile.ts`), `loadApiKey` (`mobile/src/secure/keyStore.ts`), `Button`/`Card`/`Label` (`mobile/src/components/ui`).
- Produces: `AudioNarrationPlayer({ base64: string; mime: string })` — a React component (`mobile/src/components/AudioNarrationPlayer.tsx` for native, `.web.tsx` for web), consumed by `posts.tsx`'s new `audio` mode. `FEATURES` key `"publish-audio"`, Help topic id `"publish-audio"`, `HELP_TREE` leaf id `"leaf-publish-audio"`.

- [ ] **Step 1: Install `expo-audio`**

Run: `cd mobile && npx expo install expo-audio`
Expected: adds `expo-audio` to `mobile/package.json`'s `dependencies` at the SDK-53-matched version (do not hand-pin a version — `expo install` resolves the version compatible with the installed `expo` release, currently `~53.0.27`).

- [ ] **Step 2: Write the failing `AudioNarrationPlayer` tests**

Create `mobile/__tests__/components/AudioNarrationPlayer.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AudioNarrationPlayer } from "@/components/AudioNarrationPlayer";

jest.mock("expo-file-system", () => ({
  __esModule: true,
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64" },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockPlayer = { play: jest.fn(), pause: jest.fn() };
let mockStatus = { playing: false };
jest.mock("expo-audio", () => ({
  useAudioPlayer: jest.fn(() => mockPlayer),
  useAudioPlayerStatus: jest.fn(() => mockStatus),
}));

import * as FileSystem from "expo-file-system";
import { useAudioPlayer } from "expo-audio";

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = { playing: false };
});

it("writes the base64 payload to a cache file, then plays that file:// URI", async () => {
  render(<AudioNarrationPlayer base64="AAAA" mime="audio/mpeg" />);
  await waitFor(() =>
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      "file:///cache/narration-preview.mp3",
      "AAAA",
      { encoding: "base64" },
    ),
  );
  expect(await screen.findByLabelText("Play narration")).toBeTruthy();
  expect(useAudioPlayer).toHaveBeenCalledWith("file:///cache/narration-preview.mp3");
});

it("pressing Play calls player.play()", async () => {
  render(<AudioNarrationPlayer base64="AAAA" mime="audio/mpeg" />);
  fireEvent.press(await screen.findByLabelText("Play narration"));
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

it("shows Pause and calls player.pause() while playing", async () => {
  mockStatus = { playing: true };
  render(<AudioNarrationPlayer base64="AAAA" mime="audio/mpeg" />);
  const btn = await screen.findByLabelText("Pause narration");
  fireEvent.press(btn);
  expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
});

it("fails open (renders nothing) when the cache write fails", async () => {
  (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
  render(<AudioNarrationPlayer base64="AAAA" mime="audio/mpeg" />);
  await waitFor(() => expect(FileSystem.writeAsStringAsync).toHaveBeenCalled());
  expect(screen.queryByLabelText("Play narration")).toBeNull();
});
```

- [ ] **Step 3: Run it — confirm it fails on the missing module**

Run: `cd mobile && npx jest __tests__/components/AudioNarrationPlayer.test.tsx`
Expected: FAIL — `Cannot find module '@/components/AudioNarrationPlayer'`.

- [ ] **Step 4: Implement `AudioNarrationPlayer` (native + web)**

Create `mobile/src/components/AudioNarrationPlayer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import * as FileSystem from "expo-file-system";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Button } from "@/components/ui";
import { spacing } from "@/constants/theme";

interface Props {
  base64: string;
  mime: string; // e.g. "audio/mpeg"
}

// Inline play/pause preview of a narrated-audio derivative (P1-5 P4). Native
// AVPlayer/ExoPlayer support for `data:` URIs is inconsistent across OEMs, so
// this writes the base64 payload to a cache file first (the same technique
// `epubLibrary.ts`'s native `downloadArtifact` path already uses — see
// mobile/src/storage/epubLibrary.ts:75-79) and plays that file:// URI —
// never a data: URI. See the sibling `AudioNarrationPlayer.web.tsx` (a plain
// <audio> element) for the web path, which has no such concern.
export function AudioNarrationPlayer({ base64, mime }: Props) {
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [writeError, setWriteError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFileUri(null);
    setWriteError(false);
    const ext = mime === "audio/mpeg" ? "mp3" : "audio";
    const path = `${FileSystem.cacheDirectory}narration-preview.${ext}`;
    FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 })
      .then(() => {
        if (!cancelled) setFileUri(path);
      })
      .catch(() => {
        if (!cancelled) setWriteError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base64, mime]);

  // Fail-open: if the file write fails, no playback preview — posts.tsx
  // still renders the Download button unconditionally alongside this.
  if (writeError || !fileUri) return null;
  return <AudioNarrationPlayerLoaded uri={fileUri} />;
}

function AudioNarrationPlayerLoaded({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return (
    <View style={styles.row}>
      <Button
        variant="ghost"
        label={status.playing ? "Pause" : "Play"}
        onPress={() => (status.playing ? player.pause() : player.play())}
        accessibilityLabel={status.playing ? "Pause narration" : "Play narration"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs },
});
```

Create `mobile/src/components/AudioNarrationPlayer.web.tsx`:

```tsx
import React from "react";

interface Props {
  base64: string;
  mime: string;
}

// Web path for the P1-5 P4 audio-narration preview. Unlike native
// (AudioNarrationPlayer.tsx — inconsistent data: URI support in
// AVPlayer/ExoPlayer, so it writes a cache file first), every browser's
// native <audio> element plays a data: URI directly, so no expo-audio /
// file-write dance is needed here at all.
export function AudioNarrationPlayer({ base64, mime }: Props) {
  return React.createElement("audio", {
    controls: true,
    src: `data:${mime};base64,${base64}`,
    style: { width: "100%", marginTop: 4 },
  });
}
```

- [ ] **Step 5: Run it — confirm the player tests pass**

Run: `cd mobile && npx jest __tests__/components/AudioNarrationPlayer.test.tsx`
Expected: PASS. (Jest's default `jest-expo` platform resolution picks the native `.tsx` file, not `.web.tsx` — matching how `mobile/src/reader/NativeTopicReader.web.tsx` coexists with its native sibling today.)

- [ ] **Step 6: Write the failing Publish-tab audio-mode tests**

Create `mobile/__tests__/screens/Publish.audio.test.tsx` (mirrors `Publish.animated.test.tsx`):

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import PostsScreen from "@/../app/(tabs)/posts";

jest.mock("@/hooks/useMakePost", () => ({ useMakePost: jest.fn() }));
jest.mock("@/hooks/useMakeCard", () => ({ useMakeCard: jest.fn() }));
jest.mock("@/hooks/useMakeCarousel", () => ({ useMakeCarousel: jest.fn() }));
jest.mock("@/hooks/useMakeAnimated", () => ({ useMakeAnimated: jest.fn() }));
jest.mock("@/hooks/useMakeAudio", () => ({ useMakeAudio: jest.fn() }));
jest.mock("@/lib/clipboard", () => ({ copyText: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-x") }));
jest.mock("@/lib/pickReferenceImage", () => ({ pickReferenceImage: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/api/trustClient", () => ({
  listOwnedProjects: jest.fn(),
  getProject: jest.fn(),
}));
jest.mock("@/storage/epubLibrary", () => ({ downloadArtifact: jest.fn().mockResolvedValue({}) }));
jest.mock("expo-file-system", () => ({
  __esModule: true,
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64" },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-audio", () => ({
  useAudioPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn() })),
  useAudioPlayerStatus: jest.fn(() => ({ playing: false })),
}));

import { useMakePost } from "@/hooks/useMakePost";
import { useMakeCard } from "@/hooks/useMakeCard";
import { useMakeCarousel } from "@/hooks/useMakeCarousel";
import { useMakeAnimated } from "@/hooks/useMakeAnimated";
import { useMakeAudio } from "@/hooks/useMakeAudio";
import { useAuth } from "@/auth/AuthProvider";
import { listOwnedProjects, getProject } from "@/api/trustClient";
import { downloadArtifact } from "@/storage/epubLibrary";

function mockPostHook(over: Record<string, unknown> = {}) {
  (useMakePost as jest.Mock).mockReturnValue({
    status: "idle", error: null, variants: [], provenance: null,
    run: jest.fn(), reset: jest.fn(), ...over,
  });
}
function mockCardHook(over: Record<string, unknown> = {}) {
  (useMakeCard as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null, run: jest.fn(), reset: jest.fn(), ...over,
  });
}
function mockCarouselHook(over: Record<string, unknown> = {}) {
  (useMakeCarousel as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null, run: jest.fn(), reset: jest.fn(), ...over,
  });
}
function mockAnimatedHook(over: Record<string, unknown> = {}) {
  (useMakeAnimated as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null, run: jest.fn(), reset: jest.fn(), ...over,
  });
}
function mockAudioHook(over: Record<string, unknown> = {}) {
  (useMakeAudio as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null, run: jest.fn(), reset: jest.fn(), ...over,
  });
}

const VALIDATED_PROJECT = {
  id: "proj-1", title: "Stormwater 101", status: "active",
  created_at: null, topic: null, audience: null, goal: null,
};

const VALIDATED_PROJECT_DETAIL = {
  project: {
    id: "proj-1", title: "Stormwater 101", topic: null, audience: null, goal: null,
    status: "active", created_at: null,
    toc: {
      subjects: [
        {
          subject_label: "Water",
          units: [{ id: "topic-1", title: "Detention basins", subtopics: [], prerequisites: [] }],
        },
      ],
    },
  },
  artifacts: [],
  inputs: [],
  my_role: "owner",
  topic_status: [{ topic_id: "topic-1", status: "validated", latest_version_id: "tv-1", version_no: 1 }],
};

const AUDIO_RESULT = {
  script: "Water finds the lowest point.",
  title: "Detention basins, decoded",
  audio_base64: "SUQzZmFrZQ==",
  mime: "audio/mpeg",
  provenance: "ai-generated",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPostHook();
  mockCardHook();
  mockCarouselHook();
  mockAnimatedHook();
  mockAudioHook();
  (useAuth as jest.Mock).mockReturnValue({ accessToken: "token-x", status: "signed_in" });
  (listOwnedProjects as jest.Mock).mockResolvedValue([VALIDATED_PROJECT]);
  (getProject as jest.Mock).mockResolvedValue(VALIDATED_PROJECT_DETAIL);
});

it("switching to Audio mode shows the source field", async () => {
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  expect(await screen.findByLabelText("Audio source text")).toBeTruthy();
});

it("Make narration with source text calls useMakeAudio.run with source_text", async () => {
  const runMock = jest.fn();
  mockAudioHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText("Audio source text"), "Detention basins hold stormwater.");
  fireEvent.press(screen.getByLabelText("Make narration"));
  expect(runMock).toHaveBeenCalledWith(
    expect.objectContaining({ source_text: "Detention basins hold stormwater." }),
  );
});

it("renders the title/script, an inline player, and a Download button for a returned result", async () => {
  mockAudioHook({ status: "done", result: AUDIO_RESULT });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());

  expect(screen.getByText("Detention basins, decoded")).toBeTruthy();
  expect(screen.getByText("Water finds the lowest point.")).toBeTruthy();
  expect(await screen.findByLabelText("Play narration")).toBeTruthy();
  expect(screen.getByLabelText("Download narration")).toBeTruthy();
});

it("pressing Download calls downloadArtifact with narration.mp3 and audio/mpeg", async () => {
  mockAudioHook({ status: "done", result: AUDIO_RESULT });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.press(screen.getByLabelText("Download narration"));
  await waitFor(() =>
    expect(downloadArtifact).toHaveBeenCalledWith(expect.anything(), "narration.mp3", "audio/mpeg"),
  );
});

it("picking a validated section calls useMakeAudio.run with topic_version_id, not source_text", async () => {
  const runMock = jest.fn();
  mockAudioHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  fireEvent.press(screen.getByLabelText("Audio source: Pick a validated section"));

  const row = await screen.findByLabelText(/Validated section: Stormwater 101/);
  fireEvent.press(row);
  fireEvent.press(screen.getByLabelText("Make narration"));

  expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ topic_version_id: "tv-1" }));
  const sent = runMock.mock.calls[0][0];
  expect("source_text" in sent).toBe(false);
});

it("shows the add-key message when known-not-Pro and no key", async () => {
  mockAudioHook({ status: "failed", error: "No API key saved. Go to Settings and paste your OpenAI key." });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  expect(screen.getByText(/no api key saved/i)).toBeTruthy();
});

it("does not regress the existing text-post mode", async () => {
  render(<PostsScreen />);
  expect(screen.getByLabelText("Source text")).toBeTruthy();
  expect(screen.getByLabelText("Make posts")).toBeTruthy();
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
});
```

- [ ] **Step 7: Run it — confirm it fails (no Audio mode yet)**

Run: `cd mobile && npx jest __tests__/screens/Publish.audio.test.tsx`
Expected: FAIL — `getByLabelText("Mode: Audio")` not found.

- [ ] **Step 8: Wire the `audio` mode into `posts.tsx`**

In `mobile/app/(tabs)/posts.tsx`, add imports after line 10 (`import { useMakeAnimated } from "@/hooks/useMakeAnimated";`):

```tsx
import { useMakeAudio } from "@/hooks/useMakeAudio";
import { AudioNarrationPlayer } from "@/components/AudioNarrationPlayer";
```

Change the `MODES` array (lines 30-35):

```tsx
const MODES: { id: "post" | "card" | "carousel" | "animated" | "audio"; label: string }[] = [
  { id: "post", label: "Text post" },
  { id: "card", label: "Image card" },
  { id: "carousel", label: "Carousel" },
  { id: "animated", label: "Animated" },
  { id: "audio", label: "Audio" },
];
```

Change the `mode` state type at line 146:

```tsx
const [mode, setMode] = useState<"post" | "card" | "carousel" | "animated" | "audio">("post");
```

Add the audio hook + handlers after the animated block (after `onDownloadAnimated`, which currently ends line 270):

```tsx

  // ── Audio mode ───────────────────────────────────────────────────────────
  // Reuses the SAME source switch as card/carousel/animated modes
  // (cardSource/cardText/selectedSectionId/cardTone) via renderSourcePicker —
  // no preset selector (unlike animated); the result is a script/title pair
  // plus a narrated MP3 (played inline via AudioNarrationPlayer, downloaded
  // via the existing mime-generic downloadArtifact).
  const {
    status: audioStatus, error: audioError, result: audioResult, run: runAudio,
  } = useMakeAudio({ getApiKey: () => loadApiKey("openai") });

  const audioBusy = audioStatus === "generating";
  const canMakeAudio =
    !audioBusy
    && ((cardSource === "text" && cardText.trim().length > 0)
      || (cardSource === "section" && selectedSectionId != null));

  const onMakeAudio = useCallback(() => {
    void runAudio({
      ...(cardSource === "section"
        ? { topic_version_id: selectedSectionId as string }
        : { source_text: cardText.trim() }),
      ...(cardTone.trim() ? { tone: cardTone.trim() } : {}),
    });
  }, [runAudio, cardSource, cardText, cardTone, selectedSectionId]);

  const onDownloadAudio = useCallback(async () => {
    if (!audioResult) return;
    try {
      await downloadArtifact(fromBase64(audioResult.audio_base64), "narration.mp3", "audio/mpeg");
    } catch (e) {
      Alert.alert("Could not download", e instanceof Error ? e.message : "Try again.");
    }
  }, [audioResult]);
```

Widen `renderSourcePicker`'s `kind` param and `noun` mapping (the function currently starts line 279):

```tsx
  const renderSourcePicker = (kind: "Card" | "Carousel" | "Animated" | "Audio") => {
    const noun =
      kind === "Card" ? "card"
      : kind === "Carousel" ? "carousel"
      : kind === "Animated" ? "animated card"
      : "narration";
```

Insert the audio mode's JSX between the `animated` block (which currently ends `) : null}\n          </>\n        ) : (` around line 559-560) and the default `post`-mode block, so the ternary chain reads `... : mode === "animated" ? (...) : mode === "audio" ? (...) : (`:

```tsx
        ) : mode === "audio" ? (
          <>
            {renderSourcePicker("Audio")}

            <Label tone="secondary">Tone (optional)</Label>
            <TextInput
              accessibilityLabel="Audio tone"
              style={styles.tone}
              placeholder="e.g. punchy, professional"
              placeholderTextColor={theme.textMuted}
              value={cardTone}
              onChangeText={setCardTone}
            />

            <Button
              variant="primary"
              label="Make narration"
              onPress={onMakeAudio}
              busy={audioBusy}
              disabled={!canMakeAudio}
              accessibilityLabel="Make narration"
              style={styles.generate}
            />

            {audioStatus === "failed" && audioError ? <Text style={styles.error}>{audioError}</Text> : null}

            {audioStatus === "done" && audioResult ? (
              <View style={styles.results}>
                <Label tone="muted">{humanizeProvenance(audioResult.provenance)}</Label>
                <Card style={styles.card}>
                  <Text style={styles.hook}>{audioResult.title}</Text>
                  <Text style={styles.postBody}>{audioResult.script}</Text>
                  <AudioNarrationPlayer base64={audioResult.audio_base64} mime={audioResult.mime} />
                  <Button
                    variant="ghost"
                    label="Download"
                    onPress={() => void onDownloadAudio()}
                    accessibilityLabel="Download narration"
                    style={styles.copyBtn}
                  />
                </Card>
              </View>
            ) : null}
          </>
        ) : (
```

- [ ] **Step 9: Run it — confirm the Publish audio-mode tests pass**

Run: `cd mobile && npx jest __tests__/screens/Publish.audio.test.tsx __tests__/screens/Posts.test.tsx __tests__/screens/Publish.animated.test.tsx __tests__/screens/Publish.card.test.tsx __tests__/screens/Publish.carousel.test.tsx`
Expected: PASS (no regression in the other Publish modes).

- [ ] **Step 10: Add Help feature, topic, and tree leaf**

In `mobile/src/help-content/features.ts`, insert after line 19 (`{ key: "publish-animated", label: "Publish an animated card" },`):

```ts
  { key: "publish-audio", label: "Publish narrated audio" },
```

In `mobile/src/help-content/topics.ts`, insert after the `publish-animated` topic object (which currently ends at line 604 with `},`):

```ts
  {
    id: "publish-audio",
    title: "Publish narrated audio",
    featureKey: "publish-audio",
    keywords: ["publish", "audio", "narration", "voice", "mp3", "share", "podcast", "listen"],
    blocks: [
      {
        kind: "text",
        text: "Audio mode on the Publish tab turns your own writing into a short narrated audio clip — a spoken summary a text-to-speech voice reads aloud, built from either pasted text or a validated section from one of your projects. Play it back in the app, then download the MP3 to share it yourself. This is a short narrated clip of one section, not a whole-book audiobook. Making one uses a billable LLM call plus a text-to-speech call — narration works with your own OpenAI key today (Settings); Mentible's managed plan doesn't cover audio narration yet.",
      },
      {
        kind: "steps",
        steps: [
          "Open Publish and switch to Audio mode.",
          "Choose a source: paste text, or pick a validated section from your projects.",
          "Optionally set a tone, then make the narration.",
          "Play it back in the app, or Download to save the MP3 and share it yourself.",
        ],
      },
    ],
  },
```

In `mobile/src/help-content/tree.ts`, insert after line 90 (`{ id: "leaf-publish-animated", title: "Publish an animated card", topicId: "publish-animated" },`):

```ts
      { id: "leaf-publish-audio", title: "Publish narrated audio", topicId: "publish-audio" },
```

Also update the `share-shortform` branch's `blurb` at line 85 to mention audio:

```ts
    blurb: "The Publish nav tab — posts, image cards, carousels, animated cards, narrated audio.",
```

- [ ] **Step 11: Run the Help gates**

Run: `cd mobile && npx jest --testPathPattern=help`
Expected: PASS — `coverage.test.ts` (every `FEATURES` key has a topic) and `tree.test.ts` (every topic is a reachable tree leaf) both green.

- [ ] **Step 12: Typecheck and lint the changed files**

Run: `cd mobile && npx tsc --noEmit && npx eslint app/\(tabs\)/posts.tsx src/components/AudioNarrationPlayer.tsx src/components/AudioNarrationPlayer.web.tsx src/help-content/features.ts src/help-content/topics.ts src/help-content/tree.ts __tests__/screens/Publish.audio.test.tsx __tests__/components/AudioNarrationPlayer.test.tsx`
Expected: no errors.

- [ ] **Step 13: Run the full mobile test suite once, to catch any cross-file regression**

Run: `cd mobile && npx jest`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
cd mobile
git add package.json package-lock.json src/components/AudioNarrationPlayer.tsx \
  src/components/AudioNarrationPlayer.web.tsx "app/(tabs)/posts.tsx" \
  __tests__/components/AudioNarrationPlayer.test.tsx __tests__/screens/Publish.audio.test.tsx \
  src/help-content/features.ts src/help-content/topics.ts src/help-content/tree.ts
git commit -m "feat(mobile): Audio publish mode, expo-audio player, Help topic (P1-5 P4 T4)"
```
