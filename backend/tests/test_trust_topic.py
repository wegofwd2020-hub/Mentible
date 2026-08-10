import json
import os
import uuid
from datetime import UTC, datetime

import asyncpg
import pytest
from pydantic import ValidationError

from backend.src.trust.generate_topic import (
    _coerce_topic_draft,
    _TopicDraft,
    generate_topic_draft,
)
from backend.src.trust.topic_prompt import build_topic_prompt
from backend.tests.helpers import fake_provider
from src.trust import project_repo, topic_approval_repo, topic_repo

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]


@pytest.fixture
async def conn():
    c = await asyncpg.connect(DSN)
    tx = c.transaction()
    await tx.start()
    try:
        yield c
    finally:
        await tx.rollback()
        await c.close()


async def _project(conn):
    a = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    return await project_repo.create_project(conn, owner_account_id=a, title="T")


async def test_topic_version_and_approval_roundtrip(conn):
    p = await _project(conn)
    tv = await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t1",
        title="Reading music",
        source_ids=["s1"],
        content={"sections": [{"heading": "Staff", "body": "…", "source_ids": ["s1"]}]},
        created_by_sub="sub-1",
    )
    assert tv.version_no == 1
    assert tv.title == "Reading music"
    assert tv.source_ids == ["s1"]
    assert tv.content["sections"][0]["heading"] == "Staff"
    assert await topic_repo.get_topic_version(conn, topic_version_id=tv.id) == tv
    assert await topic_repo.project_id_for_topic_version(conn, topic_version_id=tv.id) == p.id

    assert not await topic_approval_repo.is_topic_validated(conn, topic_version_id=tv.id)
    await topic_approval_repo.record_topic_approval(
        conn,
        topic_version_id=tv.id,
        expert_name="Dr X",
        approved_at=datetime.now(UTC),
        recorded_by_sub="sub-1",
        expert_email=None,
        expert_role=None,
        note=None,
        recorded_via="operator",
    )
    assert await topic_approval_repo.is_topic_validated(conn, topic_version_id=tv.id)

    # a second version for the same topic increments version_no
    tv2 = await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t1",
        title="Reading music",
        source_ids=["s1"],
        content={"sections": []},
        created_by_sub="sub-1",
    )
    assert tv2.version_no == 2
    # a fresh topic in the same project starts back at 1
    tv3 = await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t2",
        title="Dynamics",
        source_ids=[],
        content={"sections": []},
        created_by_sub="sub-1",
    )
    assert tv3.version_no == 1

    versions = await topic_repo.list_topic_versions(conn, project_id=p.id)
    assert {v.id for v in versions} == {tv.id, tv2.id, tv3.id}


async def test_withdraw_topic_approval_is_noop_when_not_approved(conn):
    p = await _project(conn)
    tv = await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t1",
        title="Reading music",
        source_ids=[],
        content={"sections": []},
        created_by_sub="sub-1",
    )
    assert (
        await topic_approval_repo.withdraw_topic_approval(
            conn, topic_version_id=tv.id, recorded_by_sub="sub-1"
        )
        is None
    )
    await topic_approval_repo.record_topic_approval(
        conn,
        topic_version_id=tv.id,
        expert_name="Dr X",
        approved_at=datetime.now(UTC),
        recorded_by_sub="sub-1",
    )
    wd = await topic_approval_repo.withdraw_topic_approval(
        conn, topic_version_id=tv.id, recorded_by_sub="sub-1"
    )
    assert wd is not None
    assert wd.action == "withdraw"
    assert not await topic_approval_repo.is_topic_validated(conn, topic_version_id=tv.id)
    # withdrawing an already-withdrawn version is a no-op
    assert (
        await topic_approval_repo.withdraw_topic_approval(
            conn, topic_version_id=tv.id, recorded_by_sub="sub-1"
        )
        is None
    )


async def test_record_topic_approval_invalid_enums(conn):
    p = await _project(conn)
    tv = await topic_repo.create_topic_version(
        conn,
        project_id=p.id,
        topic_id="t1",
        title="Reading music",
        source_ids=[],
        content={"sections": []},
        created_by_sub="sub-1",
    )
    with pytest.raises(ValueError):
        await topic_approval_repo.record_topic_approval(
            conn,
            topic_version_id=tv.id,
            expert_name="Dr X",
            approved_at=datetime.now(UTC),
            recorded_by_sub="sub-1",
            recorded_via="bogus",
        )


# --- per-topic generator (Slice C1 Task 2) -------------------------------------


class _Src:
    def __init__(self, id, kind, title, content):
        self.id, self.kind, self.title, self.content = id, kind, title, content


_SOURCES = [
    _Src(
        "11111111-1111-1111-1111-111111111111",
        "transcript",
        "Interview",
        "The staff has five lines; the clef fixes pitch.",
    )
]

_GOOD = json.dumps(
    {
        "sections": [
            {"heading": "Staff & clef", "body": "The staff has five lines.", "sources": ["S1"]},
        ]
    }
)


def test_topic_prompt_scopes_to_topic_sources_and_sections_per_subtopic():
    p = build_topic_prompt(
        _SOURCES, "Reading music", ["Staff & clef", "Note values"], "beginners", "read music"
    )
    assert "Reading music" in p
    assert "Staff & clef" in p and "Note values" in p  # subtopics drive the sections
    assert "invent nothing" in p.lower()
    assert "S1" in p


def test_topic_prompt_allows_grounded_diagrams_and_bans_placeholders():
    p = build_topic_prompt(_SOURCES, "Reading music", ["Staff & clef"], "beginners", "read music")
    low = p.lower()
    assert "mermaid" in low  # ```mermaid guidance
    assert "svg" in low  # ```svg guidance
    assert "invent nothing" in low  # grounding kept
    # placeholders explicitly banned
    assert "[image" in low or "placeholder" in low
    # mermaid must be multi-line — a one-line diagram fails to parse/render
    assert "multi-line" in low or "own line" in low
    assert "single line" in low
    # a concrete multi-line example is shown (real line breaks between statements)
    assert "flowchart td\n" in low


def test_generate_topic_draft_returns_sections(monkeypatch):
    monkeypatch.setattr(
        "backend.src.trust.generate_topic.build_provider",
        lambda *a, **k: fake_provider(text=_GOOD),
    )
    out = generate_topic_draft(
        sources=_SOURCES,
        topic_title="Reading music",
        subtopics=["Staff & clef"],
        audience="beginners",
        goal="read music",
        provider_id="anthropic",
        api_key="sk-ant-" + "x" * 20,
        model="m",
    )
    assert isinstance(out, _TopicDraft)
    assert out.sections[0].heading == "Staff & clef"
    assert out.sections[0].sources == ["S1"]


def test_coerce_topic_draft_accepts_sections_as_json_string():
    """Some models double-encode the array — `sections` comes back as a JSON
    string instead of a list. The coercion decodes it before validating."""
    section = {"heading": "Staff", "body": "5 lines", "sources": ["S1"]}
    # Normal list — unchanged.
    d = _coerce_topic_draft({"sections": [section]})
    assert len(d.sections) == 1 and d.sections[0].heading == "Staff"
    # Stringified array — coerced.
    d2 = _coerce_topic_draft({"sections": json.dumps([section])})
    assert len(d2.sections) == 1 and d2.sections[0].body == "5 lines"


def test_coerce_topic_draft_rejects_a_non_json_string():
    """A truncated/garbage sections string can't be decoded — pydantic still
    raises (repair loop then handles it), we don't silently swallow it."""
    with pytest.raises(ValidationError):
        _coerce_topic_draft({"sections": '[{"heading": "h", "body": "trunca'})
