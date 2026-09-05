from __future__ import annotations

import asyncio
import json
import math
import tempfile
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


# Sarvam's sync /speech-to-text rejects audio longer than 30s with this message;
# we detect it to fall back to the batch (long-audio) job flow.
_SARVAM_SYNC_DURATION_MARKER = "maximum limit of 30 seconds"


def _segments_from_sarvam(transcript: str, ts: dict) -> list[TranscriptSegment]:
    """Map a Sarvam timestamps block to segments. Sync returns chunk texts under
    `words`, batch under `chunks` — accept either. Parallel `start_time_seconds`
    / `end_time_seconds` arrays give the times. No per-chunk confidence (Sarvam
    only reports a whole-file `language_probability`) -> None. Falls back to a
    single segment carrying the whole transcript when timestamps are absent."""
    chunks = ts.get("chunks") or ts.get("words") or []
    starts = ts.get("start_time_seconds") or []
    ends = ts.get("end_time_seconds") or []
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
    text = (transcript or "").strip()
    if not text:
        return []
    return [TranscriptSegment(text=text, start=0.0, end=0.0, confidence=None)]


class SarvamSTTProvider:
    """Sarvam Saarika/Saaras — Indic-specialized STT. Sync path: POST
    {base}/speech-to-text (multipart), auth via the `api-subscription-key` header
    (NOT Bearer). Sarvam's sync endpoint caps audio at 30s; on that specific 400
    we transparently fall back to the BATCH job flow (`_transcribe_batch`, the
    sarvamai SDK) which handles long audio. No per-chunk confidence -> None."""

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
            # Long audio (>30s) -> Sarvam's sync endpoint 400s; use the batch job.
            if resp.status_code == 400 and _SARVAM_SYNC_DURATION_MARKER in (resp.text or ""):
                return await self._transcribe_batch(req)
            raise STTError(f"{self.provider_id} returned HTTP {resp.status_code}")

        try:
            payload = resp.json()
        except (ValueError, AttributeError) as e:
            raise STTError(f"{self.provider_id} returned a malformed payload") from e
        return _segments_from_sarvam(
            payload.get("transcript") or "", payload.get("timestamps") or {}
        )

    async def _transcribe_batch(self, req: TranscriptionRequest) -> list[TranscriptSegment]:
        """Long-audio path via the Sarvam batch job (sarvamai SDK): create job ->
        upload -> start -> poll -> download the per-file JSON. The SDK is blocking
        (it drives an Azure blob upload), so it runs in a worker thread. Lazy
        import keeps the seam importable (and httpx-pure) without the SDK unless
        batch is actually used."""
        return await asyncio.to_thread(self._run_batch_sync, req)

    def _run_batch_sync(self, req: TranscriptionRequest) -> list[TranscriptSegment]:
        try:
            from sarvamai import SarvamAI
        except ImportError as e:  # pragma: no cover - dep is in backend requirements
            raise STTError(f"{self.provider_id} batch requires the sarvamai package") from e

        client = SarvamAI(api_subscription_key=self._api_key)
        try:
            job = client.speech_to_text_job.create_job(
                model=req.model or self._model,
                mode="transcribe",
                language_code=_to_bcp47(req.language),
                with_timestamps=True,
            )
            job.upload_files(file_paths=[req.audio_path])
            job.start()
            job.wait_until_complete()
            if not job.is_successful():
                raise STTError(f"{self.provider_id} batch job did not complete")
            with tempfile.TemporaryDirectory() as out_dir:
                job.download_outputs(output_dir=out_dir)
                results = sorted(Path(out_dir).glob("*.json"))
                if not results:
                    raise STTError(f"{self.provider_id} batch job produced no output")
                payload = json.loads(results[0].read_text(encoding="utf-8"))
        except STTError:
            raise
        except Exception as e:
            raise STTError(f"{self.provider_id} batch error") from e
        return _segments_from_sarvam(
            payload.get("transcript") or "", payload.get("timestamps") or {}
        )
