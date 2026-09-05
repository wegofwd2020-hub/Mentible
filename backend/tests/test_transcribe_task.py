import json
import uuid

import fakeredis.aioredis
import pytest

import backend.src.trust.transcribe_tasks as tt
from backend.src.capture.contract import TranscriptSegment


@pytest.mark.asyncio
async def test_run_transcribe_writes_version_and_done_status(monkeypatch):
    job_id = uuid.uuid4()
    artifact_id = uuid.uuid4()
    input_id = uuid.uuid4()

    r = fakeredis.aioredis.FakeRedis()
    monkeypatch.setattr(tt, "_redis_client", lambda: r)

    # Managed path (no envelope needed): stub the vault key.
    monkeypatch.setattr(tt, "get_managed_key", lambda provider_id: "managed-key")

    # Stub the STT seam — assert the key is passed, return two segments.
    seen = {}

    async def fake_transcribe(*, provider_id, api_key, audio_path, language, model=None):
        seen.update(provider_id=provider_id, api_key=api_key, language=language)
        return [
            TranscriptSegment(text="வணக்கம்", start=0.0, end=2.0, confidence=0.9),
            TranscriptSegment(text="நன்றி", start=2.0, end=4.0, confidence=0.4),
        ]

    monkeypatch.setattr(tt, "capture_transcribe", fake_transcribe)

    # Stub the DB connection + artifact_repo.create_version.
    class _FakeVersion:
        id = uuid.uuid4()
        version_no = 1

    created = {}

    class _FakeConn:
        async def close(self):
            pass

    async def fake_connect():
        return _FakeConn()

    async def fake_create_version(conn, *, artifact_id, content, created_by_sub, generation_meta=None):
        created["content"] = content
        created["generation_meta"] = generation_meta
        return _FakeVersion()

    monkeypatch.setattr(tt, "_db_connect", fake_connect)
    monkeypatch.setattr(tt.artifact_repo, "create_version", fake_create_version)

    await tt._run_transcribe(
        job_id=job_id,
        artifact_id=artifact_id,
        input_id=input_id,
        audio_path="/var/audio/x.mp3",
        language="ta",
        provider_id="groq",
        model=None,
        managed=True,
        recorded_by_sub="sub-123",
    )

    # STT was called with the resolved managed key.
    assert seen["api_key"] == "managed-key"
    assert seen["provider_id"] == "groq" and seen["language"] == "ta"

    # Version content carries the segments + provenance.
    content = created["content"]
    assert content["language"] == "ta"
    assert [s["text"] for s in content["segments"]] == ["வணக்கம்", "நன்றி"]
    assert content["segments"][0]["speaker"] is None
    assert content["source_audio_ref"] == str(input_id)
    assert content["stt_meta"]["provider"] == "groq"

    # Job status is done with the created version id.
    raw = await r.get(f"job:{job_id}:status")
    status = json.loads(raw)
    assert status["status"] == "done"
    assert status["result"]["version_no"] == 1
