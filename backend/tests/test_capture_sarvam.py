import httpx
import pytest

from backend.src.capture import transcribe
from backend.src.capture.contract import TranscriptSegment
from backend.src.capture.errors import STTAuthError, STTError, STTRateLimitError
from backend.src.capture.providers import SarvamSTTProvider, _segments_from_sarvam


def _mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _sarvam_ok_with_timestamps():
    return {
        "request_id": "r1",
        "transcript": "வணக்கம் நன்றி",
        "language_code": "ta-IN",
        "timestamps": {
            "words": ["வணக்கம்", "நன்றி"],
            "start_time_seconds": [0.0, 2.1],
            "end_time_seconds": [2.1, 4.2],
        },
        "language_probability": 0.98,
    }


@pytest.mark.asyncio
async def test_sarvam_posts_to_its_endpoint_with_subscription_key_and_maps_segments(tmp_path):
    audio = tmp_path / "clip.mp3"
    audio.write_bytes(b"ID3fake-bytes")

    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["sub_key"] = request.headers.get("api-subscription-key")
        captured["auth"] = request.headers.get("authorization")  # must NOT be a Bearer
        captured["body"] = request.content
        return httpx.Response(200, json=_sarvam_ok_with_timestamps())

    segs = await transcribe(
        provider_id="sarvam",
        api_key="sarvam-key-123",
        audio_path=str(audio),
        language="ta",
        http_client=_mock_client(handler),
    )

    # Sarvam's own endpoint + auth header (not the OpenAI-style Bearer).
    assert captured["url"] == "https://api.sarvam.ai/speech-to-text"
    assert captured["sub_key"] == "sarvam-key-123"
    assert captured["auth"] is None
    # Language mapped ta -> ta-IN; model + timestamps requested.
    body = captured["body"]
    assert b"saaras:v3" in body
    assert b"ta-IN" in body
    assert b"with_timestamps" in body
    # Chunk timestamps -> our segments (Sarvam gives no per-chunk confidence).
    assert len(segs) == 2
    assert segs[0].text == "வணக்கம்" and segs[0].start == 0.0 and segs[0].end == 2.1
    assert segs[1].text == "நன்றி" and segs[1].start == 2.1 and segs[1].end == 4.2
    assert segs[0].confidence is None and segs[1].confidence is None


@pytest.mark.asyncio
async def test_sarvam_without_timestamps_yields_one_segment(tmp_path):
    audio = tmp_path / "clip.mp3"
    audio.write_bytes(b"x")

    def handler(_):
        return httpx.Response(
            200, json={"request_id": "r", "transcript": "ஒரு வரி", "language_code": "ta-IN"}
        )

    segs = await transcribe(
        provider_id="sarvam",
        api_key="k",
        audio_path=str(audio),
        language="ta",
        http_client=_mock_client(handler),
    )
    assert len(segs) == 1
    assert segs[0].text == "ஒரு வரி"
    assert segs[0].start == 0.0 and segs[0].end == 0.0 and segs[0].confidence is None


@pytest.mark.asyncio
async def test_sarvam_maps_401_and_429(tmp_path):
    audio = tmp_path / "clip.mp3"
    audio.write_bytes(b"x")

    with pytest.raises(STTAuthError):
        await transcribe(
            provider_id="sarvam",
            api_key="bad",
            audio_path=str(audio),
            language="ta",
            http_client=_mock_client(lambda _: httpx.Response(403, json={"error": "no"})),
        )
    with pytest.raises(STTRateLimitError):
        await transcribe(
            provider_id="sarvam",
            api_key="k",
            audio_path=str(audio),
            language="ta",
            http_client=_mock_client(lambda _: httpx.Response(429, json={"error": "slow"})),
        )


def test_segments_from_sarvam_batch_chunks_shape():
    # Batch output uses `chunks` (sync uses `words`) — the shared mapper accepts both.
    ts = {
        "chunks": ["வணக்கம்", "நன்றி"],
        "start_time_seconds": [0.0, 2.0],
        "end_time_seconds": [2.0, 3.5],
    }
    segs = _segments_from_sarvam("வணக்கம் நன்றி", ts)
    assert [s.text for s in segs] == ["வணக்கம்", "நன்றி"]
    assert segs[0].start == 0.0 and segs[1].end == 3.5
    assert all(s.confidence is None for s in segs)


def test_segments_from_sarvam_falls_back_to_single_segment():
    segs = _segments_from_sarvam("ஒரு வரி", {})
    assert len(segs) == 1 and segs[0].text == "ஒரு வரி"
    assert _segments_from_sarvam("", {}) == []


@pytest.mark.asyncio
async def test_sarvam_falls_back_to_batch_on_30s_limit(tmp_path, monkeypatch):
    audio = tmp_path / "long.mp3"
    audio.write_bytes(b"x")

    called = {}

    async def fake_batch(self, req):
        called["path"] = req.audio_path
        return [TranscriptSegment(text="from-batch", start=0.0, end=1.0, confidence=None)]

    monkeypatch.setattr(SarvamSTTProvider, "_transcribe_batch", fake_batch)

    body = '{"error":{"message":"Audio duration exceeds the maximum limit of 30 seconds."}}'

    def handler(_):
        return httpx.Response(400, text=body)

    segs = await transcribe(
        provider_id="sarvam",
        api_key="k",
        audio_path=str(audio),
        language="ta",
        http_client=_mock_client(handler),
    )
    assert called["path"] == str(audio)
    assert segs[0].text == "from-batch"


@pytest.mark.asyncio
async def test_sarvam_non_duration_400_raises_not_batch(tmp_path, monkeypatch):
    audio = tmp_path / "clip.mp3"
    audio.write_bytes(b"x")

    async def fail_batch(self, req):  # must NOT be called for a generic 400
        raise AssertionError("batch should not run for a non-duration 400")

    monkeypatch.setattr(SarvamSTTProvider, "_transcribe_batch", fail_batch)

    def handler(_):
        return httpx.Response(400, text='{"error":{"message":"bad request"}}')

    with pytest.raises(STTError):
        await transcribe(
            provider_id="sarvam",
            api_key="k",
            audio_path=str(audio),
            language="ta",
            http_client=_mock_client(handler),
        )
