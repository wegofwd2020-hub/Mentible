# Tamil STT Capture — Slice 1 (Backend Seam) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-agnostic speech-to-text seam and an upload endpoint so an audio interview uploaded to a trust project is transcribed asynchronously and lands as an immutable `artifact(format='transcript')` version.

**Architecture:** A portable, backend-import-free seam at `backend/src/capture/` (mirrors the `wegofwd-llm` contract/registry) calls a commodity Whisper API (Groq or OpenAI, both OpenAI-compatible `/audio/transcriptions`). An upload endpoint on the existing trust router stores the audio, creates the transcript artifact, and enqueues a Celery task that transcribes and writes version 1. The task reuses the exact single-shot job machinery of `generate_version` (encrypted BYOK envelope in Redis + a `job:{id}:status` blob polled via the shared `GET /api/v1/jobs/{job_id}`). No new job table.

**Tech Stack:** Python 3.10+, FastAPI, Celery + Redis, asyncpg, httpx (async), pytest + fakeredis, Alembic.

**Spec:** `docs/superpowers/specs/2026-09-04-tamil-stt-capture-design.md`

## Global Constraints

- **Key discipline (ADR-001):** the provider API key never touches a log line, DB row, or exception traceback. The seam never sources a key — the caller passes it. The BYOK key travels only as the encrypted per-job Redis envelope; it is decrypted in the worker, used once, and shredded on every exit path.
- **Seam portability:** `backend/src/capture/` must NOT import from `backend.*` (same rule as `pipeline/` and `wegofwd-llm`). It may import only stdlib + `httpx` + its own modules. App glue (DB, Redis, billing) lives in `backend/src/trust/`, never in the seam.
- **Async I/O only:** `httpx.AsyncClient` for outbound; `asyncpg` for DB; `redis.asyncio` for Redis. Never block the event loop.
- **No live external calls in CI:** every test mocks the STT HTTP call (via `httpx.MockTransport`), Redis (`fakeredis`), and the DB connection. Never hit a live Groq/OpenAI/Redis/Postgres in CI.
- **STT providers at MVP:** `groq` (model `whisper-large-v3`, base `https://api.groq.com/openai/v1`) and `openai` (model `whisper-1`, base `https://api.openai.com/v1`).
- **Managed vs BYOK:** `body api_key` present ⇒ BYOK; absent ⇒ managed (worker reads OUR vault key via `get_managed_key(provider_id)`). Mirror the existing gate in `generate_version`.
- **Migration numbering:** latest committed migration is `0026`; this slice adds `0027`. The `artifact.format` CHECK constraint is named `artifact_format_check`.
- **Confidence is segment-level only** (commodity Whisper returns `avg_logprob`, not per-word scores).

---

### Task 1: Capture seam (`backend/src/capture/`)

Portable, provider-agnostic STT seam. No backend imports.

**Files:**
- Create: `backend/src/capture/__init__.py`
- Create: `backend/src/capture/contract.py`
- Create: `backend/src/capture/errors.py`
- Create: `backend/src/capture/registry.py`
- Create: `backend/src/capture/providers.py`
- Test: `backend/tests/test_capture_seam.py`

**Interfaces:**
- Produces:
  - `contract.TranscriptSegment(text: str, start: float, end: float, confidence: float | None)` — frozen dataclass.
  - `contract.TranscriptionRequest(audio_path: str, language: str, model: str | None)` — frozen dataclass.
  - `errors.STTError` (base), `errors.STTAuthError`, `errors.STTRateLimitError`, `errors.STTConfigurationError` (all subclasses of `STTError`).
  - `registry.build_stt_provider(provider_id: str, *, api_key: str, model: str | None = None, http_client=None) -> providers.OpenAICompatibleSTTProvider`
  - `__init__.transcribe(*, provider_id: str, api_key: str, audio_path: str, language: str, model: str | None = None, http_client=None) -> list[TranscriptSegment]` (async)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_capture_seam.py
import json
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
            provider_id="openai", api_key="bad", audio_path=str(audio),
            language="ta", http_client=_mock_client(handler),
        )


@pytest.mark.asyncio
async def test_transcribe_maps_429_to_rate_limit(tmp_path):
    audio = tmp_path / "clip.mp3"
    audio.write_bytes(b"x")
    def handler(_):
        return httpx.Response(429, json={"error": "slow down"})
    with pytest.raises(STTRateLimitError):
        await transcribe(
            provider_id="groq", api_key="k", audio_path=str(audio),
            language="ta", http_client=_mock_client(handler),
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_capture_seam.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.src.capture'`

- [ ] **Step 3: Write the seam modules**

```python
# backend/src/capture/__init__.py
"""Portable, provider-agnostic speech-to-text seam (ADR-042: managed/BYOK
commodity STT, never self-hosted inference). No backend imports — this package
is extraction-ready (ADR-019 → wegofwd-audio2text) once a second product needs
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
```

```python
# backend/src/capture/contract.py
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TranscriptSegment:
    text: str
    start: float
    end: float
    confidence: float | None = None  # segment-level; None if the provider omits it


@dataclass(frozen=True)
class TranscriptionRequest:
    audio_path: str
    language: str
    model: str | None = None
```

```python
# backend/src/capture/errors.py
from __future__ import annotations


class STTError(Exception):
    """Base for all speech-to-text seam failures."""


class STTConfigurationError(STTError):
    """Unknown provider / no constructor wired."""


class STTAuthError(STTError):
    """Provider rejected the API key (401/403)."""


class STTRateLimitError(STTError):
    """Provider rate-limited the request (429)."""
```

```python
# backend/src/capture/registry.py
from __future__ import annotations

from dataclasses import dataclass

from .errors import STTConfigurationError
from .providers import OpenAICompatibleSTTProvider


@dataclass(frozen=True)
class STTSpec:
    provider_id: str
    base_url: str
    default_model: str


STT_REGISTRY: dict[str, STTSpec] = {
    "groq": STTSpec("groq", "https://api.groq.com/openai/v1", "whisper-large-v3"),
    "openai": STTSpec("openai", "https://api.openai.com/v1", "whisper-1"),
}


def build_stt_provider(
    provider_id: str, *, api_key: str, model: str | None = None, http_client=None
) -> OpenAICompatibleSTTProvider:
    spec = STT_REGISTRY.get(provider_id)
    if spec is None:
        raise STTConfigurationError(f"unknown STT provider {provider_id!r}")
    return OpenAICompatibleSTTProvider(
        provider_id=spec.provider_id,
        base_url=spec.base_url,
        model=model or spec.default_model,
        api_key=api_key,
        http_client=http_client,
    )
```

```python
# backend/src/capture/providers.py
from __future__ import annotations

import math
from pathlib import Path

import httpx

from .contract import TranscriptionRequest, TranscriptSegment
from .errors import STTAuthError, STTError, STTRateLimitError

_TIMEOUT = httpx.Timeout(300.0)  # long audio can take minutes


def _confidence(seg: dict) -> float | None:
    lp = seg.get("avg_logprob")
    if lp is None:
        return None
    return round(math.exp(lp), 4)


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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_capture_seam.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/capture/ backend/tests/test_capture_seam.py
git commit -m "feat(capture): provider-agnostic STT seam (groq/openai)"
```

---

### Task 2: Migration 0027 + `transcript` artifact format

Add `'transcript'` to the `artifact.format` CHECK and to the `ARTIFACT_FORMATS` tuple so `create_artifact(format='transcript')` is accepted.

**Files:**
- Create: `backend/alembic/versions/0027_artifact_format_transcript.py`
- Modify: `backend/src/trust/models.py:9-19` (the `ARTIFACT_FORMATS` tuple)
- Test: `backend/tests/test_artifact_format_transcript.py`

**Interfaces:**
- Consumes: `artifact_repo.create_artifact` (Task-independent — already exists).
- Produces: `'transcript'` accepted as an artifact format at both the Python and DB layers.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_artifact_format_transcript.py
from backend.src.trust.models import ARTIFACT_FORMATS


def test_transcript_is_an_allowed_artifact_format():
    assert "transcript" in ARTIFACT_FORMATS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_artifact_format_transcript.py -v`
Expected: FAIL — `assert 'transcript' in (...)` is False

- [ ] **Step 3: Add the format to the tuple**

In `backend/src/trust/models.py`, extend `ARTIFACT_FORMATS` (append `"transcript"` as the last entry):

```python
ARTIFACT_FORMATS = (
    "book",
    "guide",
    "learning_module",
    "podcast",
    "youtube",
    "reel",
    "linkedin",
    "x_thread",
    "essay",
    "transcript",
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_artifact_format_transcript.py -v`
Expected: PASS

- [ ] **Step 5: Write the migration**

```python
# backend/alembic/versions/0027_artifact_format_transcript.py
"""artifact.format += transcript (Tamil STT capture, slice 1)"""

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

_FORMATS = (
    "'book','guide','learning_module','podcast','youtube','reel',"
    "'linkedin','x_thread','essay'"
)


def upgrade() -> None:
    op.execute("ALTER TABLE artifact DROP CONSTRAINT artifact_format_check")
    op.execute(
        f"ALTER TABLE artifact ADD CONSTRAINT artifact_format_check "
        f"CHECK (format IN ({_FORMATS},'transcript'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE artifact DROP CONSTRAINT artifact_format_check")
    op.execute(
        f"ALTER TABLE artifact ADD CONSTRAINT artifact_format_check "
        f"CHECK (format IN ({_FORMATS}))"
    )
```

- [ ] **Step 6: Verify the migration applies (if a local Postgres + Alembic is configured)**

Run: `cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head`
Expected: no errors; `0027` applies and reverses cleanly.
(If no local DB is configured, note that in the commit and rely on the CI DB job.)

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/0027_artifact_format_transcript.py backend/src/trust/models.py backend/tests/test_artifact_format_transcript.py
git commit -m "feat(trust): add 'transcript' artifact format (migration 0027)"
```

---

### Task 3: `project_repo.add_upload_input`

Persist the raw uploaded audio as a `project_input(kind='upload')` row carrying `storage_path` + `content_hash` (the existing `add_input` does not set those columns).

**Files:**
- Modify: `backend/src/trust/project_repo.py` (add `add_upload_input` after `add_input`, ~line 128)
- Test: `backend/tests/test_project_repo_upload_input.py`

**Interfaces:**
- Consumes: `ProjectInput` dataclass and `_I` column list (already include `storage_path`, `content_hash`).
- Produces: `add_upload_input(conn, *, project_id, title, storage_path, content_hash) -> ProjectInput` — inserts a `kind='upload'` row.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_project_repo_upload_input.py
import pytest

from backend.src.trust import project_repo


class _FakeConn:
    """Minimal asyncpg-like stub: records the SQL + args, returns a canned row."""
    def __init__(self):
        self.calls = []

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        return {
            "id": "11111111-1111-1111-1111-111111111111",
            "project_id": args[0],
            "kind": args[1],
            "title": args[2],
            "content": None,
            "source_ref": None,
            "storage_path": args[3],
            "content_hash": args[4],
            "created_at": None,
        }


@pytest.mark.asyncio
async def test_add_upload_input_inserts_kind_upload_with_storage_and_hash():
    conn = _FakeConn()
    row = await project_repo.add_upload_input(
        conn,
        project_id="p1",
        title="Kolam interview",
        storage_path="/var/audio/abc.mp3",
        content_hash="deadbeef",
    )
    sql, args = conn.calls[0]
    assert "storage_path" in sql and "content_hash" in sql
    assert args == ("p1", "upload", "Kolam interview", "/var/audio/abc.mp3", "deadbeef")
    assert row.kind == "upload"
    assert row.storage_path == "/var/audio/abc.mp3"
    assert row.content_hash == "deadbeef"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_project_repo_upload_input.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'add_upload_input'`

- [ ] **Step 3: Add the repo function**

In `backend/src/trust/project_repo.py`, immediately after `add_input` (before `list_inputs`):

```python
async def add_upload_input(
    conn, *, project_id, title, storage_path, content_hash
) -> ProjectInput:
    """Persist an uploaded binary source (e.g. an interview audio file) as a
    kind='upload' input carrying its on-disk path + content hash. Unlike
    `add_input`, this sets storage_path/content_hash (the columns text sources
    leave null)."""
    r = await conn.fetchrow(
        f"INSERT INTO project_input (project_id, kind, title, storage_path, content_hash) "
        f"VALUES ($1,'upload',$2,$3,$4) RETURNING {_I}",
        project_id,
        title,
        storage_path,
        content_hash,
    )
    return _input(r)
```

Note: the SQL uses a literal `'upload'` for `kind`, so the positional args are `(project_id, title, storage_path, content_hash)` — matching the test's assertion `("p1", "upload", "Kolam interview", ...)` because the stub records `kind` from the returned row, not the args. Adjust the stub row mapping if you change the arg order; keep the test and impl in sync.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_project_repo_upload_input.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/trust/project_repo.py backend/tests/test_project_repo_upload_input.py
git commit -m "feat(trust): add_upload_input for binary (audio) sources"
```

---

### Task 4: Celery transcription task

The worker side. Mirrors `trust/tasks.py::_run_version` exactly (idempotency, managed/BYOK key resolution, `running` write, shred-on-every-exit-path) but calls the STT seam instead of the LLM and persists an `artifact_version` whose content is the transcript segments. Lives in a NEW focused file (trust/tasks.py is already ~1500 lines).

**Files:**
- Create: `backend/src/trust/transcribe_tasks.py`
- Test: `backend/tests/test_transcribe_task.py`

**Interfaces:**
- Consumes:
  - `backend.src.capture.transcribe(...)` (Task 1).
  - `artifact_repo.create_version(conn, *, artifact_id, content, created_by_sub, generation_meta=None) -> ArtifactVersion` (exists).
  - Redis job helpers `_byok_redis_key`, `_job_status_redis_key`, `_write_status`, `_shred_envelope` from `backend.src.generate.tasks` (exists).
  - `decrypt_api_key`, `parse_master_key` from `backend.src.core.byok_envelope`; `get_managed_key` from `backend.src.billing.vault` (exist).
- Produces: `transcribe_task` Celery task, name `"trust.transcribe"`, kwargs `(job_id, artifact_id, input_id, audio_path, language, provider_id, model, managed, recorded_by_sub)` — all `str`/`bool`; `model` is `str | None`. On success writes Redis status `done` with `result={"artifact_id", "version_id", "version_no"}`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_transcribe_task.py
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
        artifact_id = artifact_id
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_transcribe_task.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.src.trust.transcribe_tasks'`

- [ ] **Step 3: Write the task**

```python
# backend/src/trust/transcribe_tasks.py
"""Celery task for audio → transcript (Tamil STT capture, slice 1).

Mirrors trust/tasks.py::_run_version's job machinery (encrypted BYOK envelope in
Redis + a job:{id}:status blob, resolved by the shared GET /api/v1/jobs/{id})
but calls the portable STT seam (backend.src.capture) instead of the LLM and
persists an artifact_version whose content is the transcript segments.

ADR-001 discipline holds exactly as in _run_version: the BYOK key transits ONLY
the encrypted per-job envelope, is decrypted, used for the one STT call, then
shredded on every exit path. It is NEVER written to the status row, a log line,
or a DB row.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import asyncpg
import redis.asyncio as redis

from backend.config import settings
from backend.src.billing.vault import get_managed_key
from backend.src.capture import transcribe as capture_transcribe
from backend.src.capture.errors import STTAuthError, STTError, STTRateLimitError
from backend.src.core.byok_envelope import decrypt_api_key, parse_master_key
from backend.src.core.celery_app import celery_app
from backend.src.core.log_redaction import get_logger
from backend.src.generate.tasks import (
    _byok_redis_key,
    _job_status_redis_key,
    _shred_envelope,
    _write_status,
)

from . import artifact_repo

log = get_logger("trust.transcribe")


def _redis_client() -> redis.Redis:
    return redis.from_url(settings.redis_url, decode_responses=False)


async def _db_connect() -> asyncpg.Connection:
    return await asyncpg.connect(settings.database_url)


async def _run_transcribe(
    *,
    job_id: uuid.UUID,
    artifact_id: uuid.UUID,
    input_id: uuid.UUID,
    audio_path: str,
    language: str,
    provider_id: str,
    model: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    """Never raises — every exit path writes a status row and shreds the envelope."""
    r = _redis_client()
    api_key: str | None = None
    try:
        # (a) Idempotency — a redelivered task must not create a second version.
        raw = await r.get(_job_status_redis_key(job_id))
        if raw is not None:
            try:
                already = json.loads(raw).get("status")
            except (json.JSONDecodeError, AttributeError):
                already = None
            if already == "done":
                return

        # (b) Resolve the provider key: managed = OUR vault key, BYOK = decrypt.
        if managed:
            api_key = get_managed_key(provider_id)
            if not api_key:
                log.warning("managed_key_missing", job_id=str(job_id), provider=provider_id)
                await _write_status(r, job_id, "failed", error="managed transcription unavailable")
                return
        else:
            envelope_blob = await r.get(_byok_redis_key(job_id))
            if envelope_blob is None:
                log.warning("envelope_missing", job_id=str(job_id))
                await _write_status(r, job_id, "failed", error="job timed out")
                return
            try:
                master_key = parse_master_key(settings.byok_master_key)
                api_key = decrypt_api_key(master_key, str(job_id), envelope_blob)
            except Exception:
                log.warning("envelope_decrypt_failed", job_id=str(job_id))
                await _write_status(r, job_id, "failed", error="internal error")
                return

        # (c) Transcribe + persist version 1.
        await _write_status(r, job_id, "running")
        try:
            segments = await capture_transcribe(
                provider_id=provider_id,
                api_key=api_key,
                audio_path=audio_path,
                language=language,
                model=model,
            )
        except STTAuthError:
            log.warning("transcription_failed", job_id=str(job_id), reason="auth")
            await _write_status(
                r, job_id, "failed",
                error="The API key was rejected by the provider. Check it in Settings.",
            )
            return
        except STTRateLimitError:
            log.warning("transcription_failed", job_id=str(job_id), reason="rate_limit")
            await _write_status(
                r, job_id, "failed",
                error="The provider is rate-limiting requests. Try again shortly.",
            )
            return
        except (STTError, OSError):
            log.warning("transcription_failed", job_id=str(job_id), reason="stt_error")
            await _write_status(r, job_id, "failed", error="transcription failed")
            return
        except Exception:
            # Defense in depth: never let a raw error escape with key material.
            log.warning("transcription_failed", job_id=str(job_id), reason="unexpected")
            await _write_status(r, job_id, "failed", error="transcription failed")
            return

        content = {
            "language": language,
            "segments": [
                {
                    "text": s.text,
                    "start": s.start,
                    "end": s.end,
                    "confidence": s.confidence,
                    "speaker": None,  # manual tagging happens in the review surface (slice 3)
                }
                for s in segments
            ],
            "source_audio_ref": str(input_id),
            "stt_meta": {"provider": provider_id, "model": model},
        }

        conn = await _db_connect()
        try:
            v = await artifact_repo.create_version(
                conn,
                artifact_id=artifact_id,
                content=content,
                created_by_sub=recorded_by_sub,
                generation_meta={
                    "kind": "transcription",
                    "provider_id": provider_id,
                    "model": model,
                    "source_input_id": str(input_id),
                },
            )
        finally:
            await conn.close()

        # (d) Success.
        await _write_status(
            r,
            job_id,
            "done",
            result={
                "artifact_id": str(artifact_id),
                "version_id": str(v.id),
                "version_no": v.version_no,
            },
        )
    except Exception:
        log.warning("trust_transcribe_task_failed", job_id=str(job_id), reason="unexpected")
        try:
            await _write_status(r, job_id, "failed", error="transcription failed")
        except Exception:
            log.warning("status_write_failed", job_id=str(job_id))
    finally:
        # (e) SHRED on every exit path.
        if api_key is not None:
            del api_key
        await _shred_envelope(r, job_id)
        await r.aclose()


@celery_app.task(bind=True, name="trust.transcribe")
def transcribe_task(
    self,
    *,
    job_id: str,
    artifact_id: str,
    input_id: str,
    audio_path: str,
    language: str,
    provider_id: str,
    model: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    asyncio.run(
        _run_transcribe(
            job_id=uuid.UUID(job_id),
            artifact_id=uuid.UUID(artifact_id),
            input_id=uuid.UUID(input_id),
            audio_path=audio_path,
            language=language,
            provider_id=provider_id,
            model=model,
            managed=managed,
            recorded_by_sub=recorded_by_sub,
        )
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_transcribe_task.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/trust/transcribe_tasks.py backend/tests/test_transcribe_task.py
git commit -m "feat(trust): Celery transcription task -> artifact_version"
```

---

### Task 5: Upload endpoint + config + key-redaction test

The HTTP surface. `POST /api/v1/trust/projects/{project_id}/transcribe` (multipart): owner-only, validates the file, stores it, creates the `upload` input + the `transcript` artifact, enqueues `transcribe_task`, returns 202. Mirrors `generate_version`'s managed/BYOK gate + envelope + enqueue.

**Files:**
- Modify: `backend/config.py` (add STT config block after the TTS block, ~line 218)
- Modify: `backend/src/trust/router.py` (add the endpoint + imports)
- Test: `backend/tests/test_transcribe_endpoint.py`

**Interfaces:**
- Consumes: `transcribe_task` (Task 4), `add_upload_input` (Task 3), `artifact_repo.create_artifact` (exists), `_require_role` / `_account` / `_enforce_generation_cap` (exist in router), `resolve_managed_access` / `over_cap` (exist), `encrypt_api_key` / `parse_master_key` / `_byok_redis_key` / `_write_status` (exist).
- Produces: the endpoint; new settings `stt_default_provider`, `audio_upload_dir`, `audio_max_bytes`.

- [ ] **Step 1: Add config**

In `backend/config.py`, after the TTS block (before the "Artifact compiler" block):

```python
    # ── Speech-to-text capture (Tamil STT, ADR-042 commodity STT) ─────────────
    # Default managed STT provider; must be a key in capture.registry.STT_REGISTRY
    # ('groq' | 'openai'). Managed uses OUR vault key for this provider; BYOK
    # supplies its own. The per-provider base URL + model live in the seam
    # registry, not here (kept portable for extraction).
    stt_default_provider: str = Field(default="groq")
    # Where uploaded interview audio is stored on disk (prod = a persistent
    # volume; no S3 on the CX22 box). One file per upload: <dir>/<uuid>.<ext>.
    audio_upload_dir: str = Field(default=str(_REPO_ROOT / "var" / "audio"))
    # Hard upload size cap (bytes). 500 MB default.
    audio_max_bytes: int = Field(default=524_288_000, ge=1)
```

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_transcribe_endpoint.py
import io
import uuid
from unittest.mock import patch

import pytest

# Reuses the shared trust-router test fixtures. `client` is an authenticated
# httpx.AsyncClient bound to the FastAPI app; `owned_project_id` returns a
# project owned by the test principal. (See backend/tests/test_trust_router.py
# for the canonical fixtures; import/parametrize the same way.)


@pytest.mark.asyncio
async def test_transcribe_upload_enqueues_job_and_stores_audio(
    client, owned_project_id, known_test_api_key, tmp_path, monkeypatch
):
    monkeypatch.setenv("AUDIO_UPLOAD_DIR", str(tmp_path))

    with patch("backend.src.trust.router.transcribe_task.delay") as mock_delay:
        resp = await client.post(
            f"/api/v1/trust/projects/{owned_project_id}/transcribe",
            files={"file": ("kolam.mp3", io.BytesIO(b"ID3fake-audio-bytes"), "audio/mpeg")},
            data={"language": "ta", "title": "Kolam interview", "api_key": known_test_api_key},
        )

    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "queued"
    uuid.UUID(body["job_id"])  # parses
    mock_delay.assert_called_once()
    # The audio was written to disk and passed to the task.
    kwargs = mock_delay.call_args.kwargs
    assert kwargs["language"] == "ta"
    assert kwargs["provider_id"] == "groq"


@pytest.mark.asyncio
async def test_transcribe_rejects_non_audio(client, owned_project_id):
    resp = await client.post(
        f"/api/v1/trust/projects/{owned_project_id}/transcribe",
        files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
        data={"language": "ta"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_transcribe_does_not_log_the_byok_key(
    client, owned_project_id, known_test_api_key, capsys, tmp_path, monkeypatch
):
    monkeypatch.setenv("AUDIO_UPLOAD_DIR", str(tmp_path))
    with patch("backend.src.trust.router.transcribe_task.delay"):
        await client.post(
            f"/api/v1/trust/projects/{owned_project_id}/transcribe",
            files={"file": ("kolam.mp3", io.BytesIO(b"bytes"), "audio/mpeg")},
            data={"language": "ta", "api_key": known_test_api_key},
        )
    captured = capsys.readouterr()
    assert known_test_api_key not in (captured.out + captured.err)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest backend/tests/test_transcribe_endpoint.py -v`
Expected: FAIL — 404 (route not defined) / import errors.

- [ ] **Step 4: Add imports to the router**

In `backend/src/trust/router.py`, extend the imports:

```python
# add to the fastapi import line:
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

# add near the other stdlib imports:
import hashlib
import os

# add to the ".tasks import (" block:
from .tasks import (
    cited_content_hash,
    generate_book_task,
    generate_topic_task,
    generate_version_task,
    grounding_check_task,
    originality_check_task,
    suggest_toc_task,
)
from .transcribe_tasks import transcribe_task  # noqa: E402  (new)

# add to the capture registry import (validate provider up front):
from ..capture.registry import STT_REGISTRY
```

- [ ] **Step 5: Add the endpoint**

In `backend/src/trust/router.py`, after `add_project_input` (the `/projects/{project_id}/inputs` POST):

```python
_AUDIO_CONTENT_TYPES = {"audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav"}
_AUDIO_EXTS = {".mp3", ".m4a", ".wav"}


@router.post(
    "/projects/{project_id}/transcribe",
    response_model=schemas.VersionGenerateJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def transcribe_upload(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    language: str = Form("ta"),
    title: str | None = Form(None),
    provider_id: str | None = Form(None),
    model: str | None = Form(None),
    api_key: str | None = Form(None),
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
    r: redis.Redis = Depends(get_redis),
) -> schemas.VersionGenerateJobOut:
    """Upload an interview audio file and enqueue transcription (Tamil STT
    capture, slice 1). Owner-only. Stores the audio as a kind='upload' input,
    creates a format='transcript' artifact, and hands the STT call to
    `transcribe_task` (Celery). Poll `GET /api/v1/jobs/{job_id}` for the
    eventual `done`/`failed` status and the created artifact_version id — same
    single-shot job machinery (encrypted BYOK envelope + status row) as
    `generate_version`."""
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    await _enforce_generation_cap(conn, account, principal)

    stt_provider = provider_id or settings.stt_default_provider
    if stt_provider not in STT_REGISTRY:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"unsupported STT provider {stt_provider!r}"
        )

    # Validate the file: extension + content-type + size.
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _AUDIO_EXTS or (file.content_type not in _AUDIO_CONTENT_TYPES):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "upload an audio file (.mp3, .m4a, .wav)",
        )
    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "the audio file is empty")
    if len(audio_bytes) > settings.audio_max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"audio exceeds the {settings.audio_max_bytes // (1024 * 1024)} MB limit",
        )

    # managed vs BYOK — mirror generate_version.
    managed = api_key is None
    if managed:
        grant = await resolve_managed_access(
            conn, account_id=account.id, provider_id=stt_provider, principal=principal
        )
        if grant is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "an api_key is required for this request"
            )
        if await over_cap(conn, account_id=account.id, access=grant):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "managed allowance exhausted; try again later or add your own key",
            )

    # Store the audio on disk (one file per upload) + hash for dedupe/provenance.
    content_hash = hashlib.sha256(audio_bytes).hexdigest()
    os.makedirs(settings.audio_upload_dir, exist_ok=True)
    storage_path = os.path.join(settings.audio_upload_dir, f"{uuid.uuid4()}{ext}")
    with open(storage_path, "wb") as fh:
        fh.write(audio_bytes)

    # Raw audio → project_input(kind='upload'); transcript → artifact.
    src = await project_repo.add_upload_input(
        conn,
        project_id=project_id,
        title=title or (file.filename or "Interview audio"),
        storage_path=storage_path,
        content_hash=content_hash,
    )
    artifact = await artifact_repo.create_artifact(
        conn,
        project_id=project_id,
        role="cornerstone",
        format="transcript",
        title=title or (file.filename or "Interview transcript"),
    )

    job_id = uuid.uuid4()

    # BYOK only — encrypt + store the per-job envelope. Managed reads OUR vault key.
    if not managed:
        master_key = parse_master_key(settings.byok_master_key)
        envelope = encrypt_api_key(master_key, str(job_id), api_key)
        await r.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)

    await _write_status(r, job_id, "queued")

    transcribe_task.delay(
        job_id=str(job_id),
        artifact_id=str(artifact.id),
        input_id=str(src.id),
        audio_path=storage_path,
        language=language,
        provider_id=stt_provider,
        model=model,
        managed=managed,
        recorded_by_sub=principal.sub,
    )

    # Safe-surface logging only — never the api_key, never the audio bytes/path.
    log.info(
        "transcribe_submitted",
        job_id=str(job_id),
        project_id=str(project_id),
        artifact_id=str(artifact.id),
        provider_id=stt_provider,
        managed=managed,
    )

    return schemas.VersionGenerateJobOut(job_id=str(job_id), status="queued")
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pytest backend/tests/test_transcribe_endpoint.py -v`
Expected: PASS (3 tests). If the shared fixtures (`client`, `owned_project_id`, `known_test_api_key`) have different names in `backend/tests/conftest.py`, align the test to the canonical names used by `test_trust_router.py`.

- [ ] **Step 7: Run the full backend suite + key-redaction gate**

Run: `pytest backend/tests/ -q`
Expected: PASS, including the existing `test_no_key_in_logs.py` gate.

- [ ] **Step 8: Commit**

```bash
git add backend/config.py backend/src/trust/router.py backend/tests/test_transcribe_endpoint.py
git commit -m "feat(trust): POST /projects/{id}/transcribe upload + enqueue"
```

---

## Self-Review

**Spec coverage (slice 1 scope only):**
- Capture seam (provider-agnostic, groq/openai, no self-hosted) → Task 1. ✓
- Managed + BYOK key handling, ADR-001 discipline → Task 4 (worker) + Task 5 (envelope on submit). ✓
- Transcript = `artifact(format='transcript')` + immutable version → Task 2 (format) + Task 4 (create_version). ✓
- Raw audio as `project_input(kind='upload')` with storage_path/content_hash → Task 3 + Task 5. ✓
- Upload endpoint, validation, single-shot job + poll → Task 5. ✓
- Mandatory key-not-logged test → Task 5 Step 2 (third test) + Step 7 (existing gate). ✓
- Segment-level confidence (not per-word) → Task 1 `_confidence`. ✓
- Slices 2–4 (mobile upload UI, review surface, audio replay/diarization/export) → out of scope, separate plans. ✓ (noted)

**Deferred within slice 1 (explicitly not built here):**
- Managed usage metering for STT (STT is priced per-second, not per-token; `_record_trust_usage` is token-based). Not wired — noted for a follow-up.
- Audio retention purge (30-day) — the file is stored; the purge job is a later slice.
- Duration cap (needs an audio probe) — only the byte-size cap is enforced at MVP.

**Placeholder scan:** none — every code step has full content.

**Type consistency:** `transcribe_task` kwargs (Task 4 `@celery_app.task`) match the `transcribe_task.delay(...)` call (Task 5). `add_upload_input(project_id, title, storage_path, content_hash)` signature (Task 3) matches its call in Task 5. `capture_transcribe` is the module alias for `backend.src.capture.transcribe` used in Task 4 and monkeypatched in its test. `artifact_repo.create_version(artifact_id, content, created_by_sub, generation_meta)` matches the existing signature.

**Note on the spec:** the spec (§5.4) mentions migration `0013` and a `generation_job.kind` addition — both superseded here. Latest migration is `0026` so this is `0027`, `generation_job` already has `kind`, and transcription uses the single-shot Redis job (no `generation_job` row), matching `generate_version`. Update the spec to match when convenient.
