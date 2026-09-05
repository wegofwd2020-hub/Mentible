from __future__ import annotations

import math
from pathlib import Path
from typing import Protocol

import httpx

from .contract import TranscriptionRequest, TranscriptSegment
from .errors import STTAuthError, STTError, STTRateLimitError

_TIMEOUT = httpx.Timeout(300.0)  # long audio can take minutes


class STTProvider(Protocol):
    async def transcribe(self, req: TranscriptionRequest) -> list[TranscriptSegment]: ...


def _confidence(seg: dict) -> float | None:
    lp = seg.get("avg_logprob")
    if lp is None:
        return None
    return round(math.exp(lp), 4)


def _to_bcp47(language: str) -> str:
    """Map our internal ISO-639 code (e.g. 'ta') to Sarvam's BCP-47 region code
    (e.g. 'ta-IN'). Pass through anything already regioned, or the 'unknown'
    auto-detect sentinel."""
    if not language or language == "unknown" or "-" in language:
        return language or "unknown"
    return f"{language}-IN"


class OpenAICompatibleSTTProvider:
    """Groq and OpenAI both expose POST {base}/audio/transcriptions (multipart)
    returning verbose_json with a `segments` array. One class serves both."""

    def __init__(self, *, provider_id, base_url, model, api_key, http_client=None):
        self.provider_id = provider_id
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._api_key = api_key
        self._client = http_client  # injected in tests; else we make our own

    async def transcribe(self, req: TranscriptionRequest) -> list[TranscriptSegment]:
        audio_bytes = Path(req.audio_path).read_bytes()
        files = {"file": (Path(req.audio_path).name, audio_bytes)}
        data = {
            "model": req.model or self._model,
            "language": req.language,
            "response_format": "verbose_json",
        }
        client = self._client or httpx.AsyncClient(timeout=_TIMEOUT)
        own_client = self._client is None
        try:
            resp = await client.post(
                f"{self._base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                files=files,
                data=data,
            )
        except httpx.HTTPError as e:
            raise STTError(f"{self.provider_id} transport error") from e
        finally:
            if own_client:
                await client.aclose()

        if resp.status_code in (401, 403):
            raise STTAuthError(f"{self.provider_id} authentication failed")
        if resp.status_code == 429:
            raise STTRateLimitError(f"{self.provider_id} rate limited")
        if resp.status_code >= 400:
            raise STTError(f"{self.provider_id} returned HTTP {resp.status_code}")

        try:
            payload = resp.json()
            segments = payload["segments"]
        except (ValueError, KeyError, TypeError) as e:
            raise STTError(f"{self.provider_id} returned a malformed payload") from e

        return [
            TranscriptSegment(
                text=(s.get("text") or "").strip(),
                start=float(s.get("start", 0.0)),
                end=float(s.get("end", 0.0)),
                confidence=_confidence(s),
            )
            for s in segments
        ]


class SarvamSTTProvider:
    """Sarvam Saarika/Saaras — Indic-specialized STT. POST {base}/speech-to-text
    (multipart), auth via the `api-subscription-key` header (NOT Bearer). With
    `with_timestamps=true` the response carries chunk-level (sentence/phrase)
    timestamps as parallel arrays; we map each chunk to a segment. Sarvam gives
    no per-chunk confidence (only a whole-file `language_probability`), so
    segment confidence is None — the review UI treats that as "needs review"."""

    def __init__(self, *, provider_id, base_url, model, api_key, http_client=None):
        self.provider_id = provider_id
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._api_key = api_key
        self._client = http_client

    async def transcribe(self, req: TranscriptionRequest) -> list[TranscriptSegment]:
        audio_bytes = Path(req.audio_path).read_bytes()
        files = {"file": (Path(req.audio_path).name, audio_bytes)}
        data = {
            "model": req.model or self._model,
            "language_code": _to_bcp47(req.language),
            "mode": "transcribe",
            "with_timestamps": "true",
        }
        client = self._client or httpx.AsyncClient(timeout=_TIMEOUT)
        own_client = self._client is None
        try:
            resp = await client.post(
                f"{self._base_url}/speech-to-text",
                headers={"api-subscription-key": self._api_key},
                files=files,
                data=data,
            )
        except httpx.HTTPError as e:
            raise STTError(f"{self.provider_id} transport error") from e
        finally:
            if own_client:
                await client.aclose()

        if resp.status_code in (401, 403):
            raise STTAuthError(f"{self.provider_id} authentication failed")
        if resp.status_code == 429:
            raise STTRateLimitError(f"{self.provider_id} rate limited")
        if resp.status_code >= 400:
            raise STTError(f"{self.provider_id} returned HTTP {resp.status_code}")

        try:
            payload = resp.json()
            transcript = (payload.get("transcript") or "").strip()
            ts = payload.get("timestamps") or {}
        except (ValueError, AttributeError) as e:
            raise STTError(f"{self.provider_id} returned a malformed payload") from e

        chunks = ts.get("words") or []
        starts = ts.get("start_time_seconds") or []
        ends = ts.get("end_time_seconds") or []
        # Chunk-level timestamps -> one segment per chunk when present and aligned;
        # otherwise a single segment carrying the whole transcript.
        if chunks and len(chunks) == len(starts) == len(ends):
            return [
                TranscriptSegment(
                    text=(chunks[i] or "").strip(),
                    start=float(starts[i]),
                    end=float(ends[i]),
                    confidence=None,
                )
                for i in range(len(chunks))
            ]
        if not transcript:
            return []
        return [TranscriptSegment(text=transcript, start=0.0, end=0.0, confidence=None)]
