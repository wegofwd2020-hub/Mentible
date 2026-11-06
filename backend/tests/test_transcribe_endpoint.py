"""Tests for POST /api/v1/trust/projects/{id}/transcribe (Tamil STT capture,
slice 1). DB-gated (real Postgres) exactly like test_trust_router.py — these
run in the CI DB job and skip when DATABASE_URL is unset."""

import io
import os
import uuid
from unittest.mock import patch

import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal
from backend.src.core.redis_dep import get_redis

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


def _as(sub, email):
    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub=sub, email=email, issuer="test", is_super_admin=False
    )


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _redis():
    fake = fakeredis.aioredis.FakeRedis(decode_responses=False)
    app.dependency_overrides[get_redis] = lambda: fake
    yield fake


@pytest.fixture(autouse=True)
def _audio_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "audio_upload_dir", str(tmp_path))
    yield tmp_path


def _new_owned_project(c) -> str:
    _as(f"u-{uuid.uuid4()}", f"o-{uuid.uuid4()}@x.z")
    return c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]


def test_transcribe_upload_enqueues_job_and_stores_audio(known_test_api_key, _audio_dir):
    with TestClient(app) as c:
        pid = _new_owned_project(c)
        with patch("backend.src.trust.router.transcribe_task.delay") as mock_delay:
            resp = c.post(
                f"/api/v1/trust/projects/{pid}/transcribe",
                files={"file": ("kolam.mp3", io.BytesIO(b"ID3fake-audio-bytes"), "audio/mpeg")},
                data={"language": "ta", "title": "Kolam interview", "api_key": known_test_api_key},
            )

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    uuid.UUID(body["job_id"])  # parses
    mock_delay.assert_called_once()
    kwargs = mock_delay.call_args.kwargs
    assert kwargs["language"] == "ta"
    assert kwargs["provider_id"] == "groq"
    assert kwargs["managed"] is False  # api_key supplied -> BYOK
    # The audio landed on disk in the configured dir.
    assert any(p.suffix == ".mp3" for p in _audio_dir.iterdir())


def test_transcribe_rejects_non_audio():
    with TestClient(app) as c:
        pid = _new_owned_project(c)
        resp = c.post(
            f"/api/v1/trust/projects/{pid}/transcribe",
            files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
            data={"language": "ta", "api_key": "sk-x"},
        )
    assert resp.status_code == 422


def test_transcribe_does_not_log_the_byok_key(known_test_api_key, capsys):
    with TestClient(app) as c:
        pid = _new_owned_project(c)
        with patch("backend.src.trust.router.transcribe_task.delay"):
            c.post(
                f"/api/v1/trust/projects/{pid}/transcribe",
                files={"file": ("kolam.mp3", io.BytesIO(b"bytes"), "audio/mpeg")},
                data={"language": "ta", "api_key": known_test_api_key},
            )
    captured = capsys.readouterr()
    assert known_test_api_key not in (captured.out + captured.err)


def test_transcribe_is_not_counted_against_the_free_generation_cap(
    known_test_api_key, _audio_dir, monkeypatch
):
    """Transcription is outside the Free generations cap (decided 2026-11-06): at a zero
    cap a valid upload still queues, and the audio is stored."""
    monkeypatch.setattr(settings, "free_max_generations", 0)
    with TestClient(app) as c:
        pid = _new_owned_project(c)
        with patch("backend.src.trust.router.transcribe_task.delay") as mock_delay:
            resp = c.post(
                f"/api/v1/trust/projects/{pid}/transcribe",
                files={"file": ("kolam.mp3", io.BytesIO(b"ID3fake-audio-bytes"), "audio/mpeg")},
                data={"language": "ta", "api_key": known_test_api_key},
            )
    assert resp.status_code == 202, resp.text
    mock_delay.assert_called_once()
    assert len(list(_audio_dir.iterdir())) == 1


def _upload(c, pid, payload: bytes, api_key):
    return c.post(
        f"/api/v1/trust/projects/{pid}/transcribe",
        files={"file": ("kolam.mp3", io.BytesIO(payload), "audio/mpeg")},
        data={"language": "ta", "api_key": api_key},
    )


def test_transcribe_refused_over_free_storage_cap_writes_no_file(
    known_test_api_key, _audio_dir, monkeypatch
):
    monkeypatch.setattr(settings, "free_max_upload_bytes", 10)
    with TestClient(app) as c:
        pid = _new_owned_project(c)
        with patch("backend.src.trust.router.transcribe_task.delay") as mock_delay:
            resp = _upload(c, pid, b"ID3fake-audio-bytes", known_test_api_key)
    assert resp.status_code == 402, resp.text
    assert "MB of uploaded audio" in resp.json()["detail"]
    mock_delay.assert_not_called()
    assert list(_audio_dir.iterdir()) == []


def test_transcribe_storage_cap_counts_earlier_uploads(known_test_api_key, _audio_dir, monkeypatch):
    # 19-byte payloads: the first fits under a 30-byte cap, the second would total 38.
    monkeypatch.setattr(settings, "free_max_upload_bytes", 30)
    with TestClient(app) as c:
        pid = _new_owned_project(c)
        with patch("backend.src.trust.router.transcribe_task.delay"):
            first = _upload(c, pid, b"ID3fake-audio-bytes", known_test_api_key)
            second = _upload(c, pid, b"ID3fake-audio-bytes", known_test_api_key)
    assert first.status_code == 202, first.text
    assert second.status_code == 402, second.text
    assert len(list(_audio_dir.iterdir())) == 1


def test_deleting_an_upload_frees_its_audio_file(known_test_api_key, _audio_dir):
    import asyncio

    import asyncpg

    with TestClient(app) as c:
        pid = _new_owned_project(c)
        with patch("backend.src.trust.router.transcribe_task.delay"):
            resp = _upload(c, pid, b"ID3fake-audio-bytes", known_test_api_key)
        assert resp.status_code == 202, resp.text
        assert len(list(_audio_dir.iterdir())) == 1

        async def _input_id():
            conn = await asyncpg.connect(os.environ["DATABASE_URL"])
            try:
                return await conn.fetchval(
                    "SELECT id FROM project_input WHERE project_id = $1 AND kind = 'upload'",
                    uuid.UUID(pid),
                )
            finally:
                await conn.close()

        input_id = asyncio.run(_input_id())
        assert c.delete(f"/api/v1/trust/inputs/{input_id}").status_code == 204
    assert list(_audio_dir.iterdir()) == []
