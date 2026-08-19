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
