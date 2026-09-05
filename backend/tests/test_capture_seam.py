import httpx
import pytest

from backend.src.capture import transcribe
from backend.src.capture.errors import STTAuthError, STTRateLimitError


def _mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _verbose_json_ok():
    return {
        "language": "ta",
        "duration": 4.2,
        "segments": [
            {"id": 0, "start": 0.0, "end": 2.1, "text": " வணக்கம்", "avg_logprob": -0.10},
            {"id": 1, "start": 2.1, "end": 4.2, "text": " நன்றி", "avg_logprob": -0.90},
        ],
    }


@pytest.mark.asyncio
async def test_transcribe_parses_segments_and_confidence(tmp_path):
    audio = tmp_path / "clip.mp3"
    audio.write_bytes(b"ID3fake-bytes")

    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json=_verbose_json_ok())

    segs = await transcribe(
        provider_id="groq",
        api_key="sk-test-123",
        audio_path=str(audio),
        language="ta",
        http_client=_mock_client(handler),
    )

    assert captured["url"] == "https://api.groq.com/openai/v1/audio/transcriptions"
    assert captured["auth"] == "Bearer sk-test-123"
    assert len(segs) == 2
    assert segs[0].text == "வணக்கம்"
    assert segs[0].start == 0.0 and segs[0].end == 2.1
    # confidence = exp(avg_logprob), rounded
    assert segs[0].confidence == pytest.approx(0.905, abs=0.01)
    assert segs[1].confidence == pytest.approx(0.407, abs=0.01)


@pytest.mark.asyncio
async def test_transcribe_maps_401_to_auth_error(tmp_path):
    audio = tmp_path / "clip.mp3"
    audio.write_bytes(b"x")

    def handler(_):
        return httpx.Response(401, json={"error": "bad key"})

    with pytest.raises(STTAuthError):
        await transcribe(
            provider_id="openai",
            api_key="bad",
            audio_path=str(audio),
            language="ta",
            http_client=_mock_client(handler),
        )


@pytest.mark.asyncio
async def test_transcribe_maps_429_to_rate_limit(tmp_path):
    audio = tmp_path / "clip.mp3"
    audio.write_bytes(b"x")

    def handler(_):
        return httpx.Response(429, json={"error": "slow down"})

    with pytest.raises(STTRateLimitError):
        await transcribe(
            provider_id="groq",
            api_key="k",
            audio_path=str(audio),
            language="ta",
            http_client=_mock_client(handler),
        )
