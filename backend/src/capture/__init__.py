"""Portable, provider-agnostic speech-to-text seam (ADR-042: managed/BYOK
commodity STT, never self-hosted inference). No backend imports — this package
is extraction-ready (ADR-019 -> wegofwd-audio2text) once a second product needs
it. Mirrors the wegofwd-llm contract/registry shape."""

from __future__ import annotations

from .contract import TranscriptionRequest, TranscriptSegment
from .registry import build_stt_provider

__all__ = ["TranscriptSegment", "TranscriptionRequest", "build_stt_provider", "transcribe"]


async def transcribe(
    *,
    provider_id: str,
    api_key: str,
    audio_path: str,
    language: str,
    model: str | None = None,
    http_client=None,
) -> list[TranscriptSegment]:
    """Transcribe one audio file. The caller ALWAYS passes the key (ADR-001);
    the seam never sources or logs it. `http_client` (an httpx.AsyncClient) is
    for injecting a MockTransport in tests."""
    provider = build_stt_provider(
        provider_id, api_key=api_key, model=model, http_client=http_client
    )
    return await provider.transcribe(
        TranscriptionRequest(audio_path=audio_path, language=language, model=model)
    )
