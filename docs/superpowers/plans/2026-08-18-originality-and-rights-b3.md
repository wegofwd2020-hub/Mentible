# Originality & Rights (B3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship B3's two parts on the existing trust-workspace stack: (A) an owner-only, billable, async **source-overlap originality check** that clones the P1-4 grounding machinery end-to-end (migration, repo, LLM-seam generator, worker task, endpoints, mobile card + client), and (B) a per-project **rights attestation** (owner-only, display-only, never gates export) surfaced on the project detail response and threaded into the exported book's `dc:rights` colophon line from the mobile client.

**Architecture:** Part A is a byte-for-byte structural clone of the P1-4 grounding feature (`backend/src/trust/{grounding_repo,grounding}.py`, the `_run_grounding_check`/`grounding_check_task` pair in `tasks.py`, the `grounding-check` endpoints + `q["grounding"]` read-time attach in `router.py`, and the Grounding row in `mobile/src/components/QualityCard.tsx`) with every "grounding" swapped for "originality" and a different LLM prompt/report shape (per-section `overlap: none|paraphrase|verbatim` instead of per-claim `supported|partial|unsupported`). It reuses the LLM seam (`build_provider`/`generate_validated`/`parse_json_response`), the managed/BYOK key fork (`resolve_managed_access`, `get_managed_key`, `encrypt_api_key`/`decrypt_api_key`), the shared job-status Redis machinery, and `cited_content_hash` for the read-time `stale` flag — nothing new is invented. Part B adds two nullable columns to the `project` row, one owner-only `PUT` endpoint, and — since `POST /api/v1/export` is stateless/key-free and compiles a **client-assembled** `book.json` (confirmed by reading `backend/src/export/router.py` and `backend/src/export/trust.py` — there is no `project_id` anywhere in that path) — the `dc:rights` thread happens entirely on the **mobile** client: `mobile/src/lib/artifactToBook.ts` and `topicsToBook.ts` gain an optional `metadata` parameter, and `mobile/app/trust/[projectId].tsx` computes it from the project's attested rights holder before calling `trackedExport`/`saveBook`. **No compiler change is needed** — `compiler/src/colophon.ts:18-19` already reads `book.metadata.rights` with an author-based fallback (`compiler/src/types.ts:124`).

**Tech Stack:** FastAPI + `asyncpg` (backend/src/trust/*), Alembic raw-SQL migrations, `wegofwd_llm` seam (`build_provider`/`generate_validated`/`parse_json_response`), Celery (`backend/src/core/celery_app.py`), Redis job-status protocol shared with `backend/src/generate/tasks.py`, pytest + `fakeredis.aioredis` + a real Postgres (`DATABASE_URL`), React Native + Expo Router (mobile/app/trust/*), Jest + `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-08-18-originality-and-rights-b3-design.md`

## Global Constraints

- Clone the grounding pattern precisely — owner-only via `_require_role(conn, account, project_id, allow=("owner",))`, billable managed/BYOK key fork, async Celery job (202 + poll the shared `GET /api/v1/jobs/{id}` endpoint), stored per-version, read-time `stale` hash. Reuse `cited_content_hash` (`backend/src/trust/tasks.py:59`), `resolve_managed_access`/`over_cap` (`backend/src/billing/access.py`), `encrypt_api_key`/`decrypt_api_key`/`parse_master_key` (`backend/src/core/byok_envelope.py`), `get_managed_key` (`backend/src/billing/vault.py`), `_record_trust_usage` (`backend/src/trust/tasks.py:95`) — do NOT reinvent them.
- **ADR-001: the LLM/BYOK API key must NEVER be logged, persisted, or in a traceback.** Every task that touches a key includes a test asserting the key is absent from logs/status payload — mirroring `test_derivatives_generate.py`'s `assert _API_KEY not in caplog.text` and `test_trust_grounding_task.py`'s `test_status_payload_never_contains_the_key_on_success` / `test_trust_grounding_endpoint.py`'s `assert key not in r.text`.
- Reuse the LLM seam (`build_provider`/`generate_validated`/`parse_json_response` from `backend/src/trust/generate.py`) — NO new outbound HTTP client, NO third-party plagiarism API this slice.
- `asyncpg`/`aioredis`/`httpx.AsyncClient` only; no `backend/__init__.py`; run `ruff format` on every changed `.py` file before committing. Migrations chain from the CONFIRMED current alembic head `0021` (verified: `backend/alembic/versions/0021_version_grounding.py`, `down_revision = "0020"`, and no later file exists) — this plan's new migrations are `0022` and `0023`. App-level `require_project_access` / `_require_role` — no Postgres RLS, no tenant column.
- Originality UI must be clearly labeled "checks your cited sources" (not against-the-web). Rights attestation is DISPLAY-ONLY — it must never appear in any gate, wall, or export precondition.
- Mobile: any new user-facing action gets a `FEATURES` key (`mobile/src/help-content/features.ts`) + a Help topic with the matching `featureKey` (`mobile/src/help-content/topics.ts`) + a `HELP_TREE` leaf (`mobile/src/help-content/tree.ts`) in the SAME task — `mobile/__tests__/help/coverage.test.ts` and `mobile/__tests__/help/tree.test.ts` fail otherwise (every topic must be reachable in the tree; every topic's `featureKey` must exist in `FEATURES`). Use `@/lib/alert`'s `Alert`, not `react-native`'s.
- Type/name consistency held across every task: `generate_originality`, `originality_repo`, `originality_check_task`, `_run_originality_check`, `OriginalityReport`, `runOriginalityCheck`/`runTopicOriginalityCheck`, `saveRights` — the same names are used verbatim wherever they recur below.

---

### Task 1: Backend originality data model + compute (no endpoint yet)

**Files:**
- Create: `backend/alembic/versions/0022_version_originality.py`
- Create: `backend/src/trust/originality_repo.py`
- Create: `backend/src/trust/originality.py`
- Test: `backend/tests/test_trust_originality_repo.py`
- Test: `backend/tests/test_trust_originality.py`

**Interfaces:**
- Consumes: `backend.src.trust.generate.{LLMRequest, build_provider, generate_validated, parse_json_response}` (existing, `backend/src/trust/generate.py`); `backend.src.trust.project_repo.create_project` / `backend.src.trust.artifact_repo.{create_artifact,create_version}` (existing, for tests).
- Produces: `originality_repo.upsert(conn, *, version_id, version_kind, report, model, cited_content_hash) -> None`; `originality_repo.get(conn, *, version_id, version_kind) -> dict | None` (report dict + `model`/`checked_at`/`cited_content_hash` merged in, `cited_content_hash` present for the caller to `.pop()` — same contract as `grounding_repo.get`). `originality.generate_originality(*, sections, sources, provider_id, api_key, model) -> tuple[dict, int, int]` returning `(report, input_tokens, output_tokens)` where `report = {"sections": [{"index": int, "heading": str, "overlap": "none"|"paraphrase"|"verbatim", "note": str|None, "source_ref": str|None}], "summary": {"verbatim": int, "paraphrase": int, "clean": int, "total": int}}`. `originality.build_originality_prompt(heading: str, body: str, cited: list[tuple[str, str]]) -> str`. Table `version_originality(version_id uuid, version_kind text, report jsonb, model text, checked_at timestamptz, cited_content_hash text, PRIMARY KEY(version_id, version_kind))` — used by Task 2's worker/router and nothing else.

- [ ] **Step 1: Write the migration**

`backend/alembic/versions/0022_version_originality.py`:

```python
"""version_originality — stored LLM source-overlap originality report per
trust version (B3 Part A). Same shape as version_grounding (0021): PK
(version_id, version_kind), a jsonb report, the model that produced it, and
cited_content_hash for the read-time stale check."""

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE version_originality (
            version_id uuid NOT NULL,
            version_kind text NOT NULL CHECK (version_kind IN ('artifact','topic')),
            report jsonb NOT NULL,
            model text NOT NULL,
            checked_at timestamptz NOT NULL DEFAULT now(),
            cited_content_hash text NOT NULL,
            PRIMARY KEY (version_id, version_kind)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE version_originality")
```

- [ ] **Step 2: Apply the migration and confirm it's the new head**

Run: `cd backend && alembic upgrade head && alembic heads`
Expected: no errors; `alembic heads` prints `0022 (head)`.

- [ ] **Step 3: Write the failing repo test**

`backend/tests/test_trust_originality_repo.py`:

```python
"""TDD for `originality_repo` (B3 T1) — persistence for the per-version LLM
source-overlap originality report. Mirrors `test_generation_job_repo.py`'s
DB-transaction fixture; the upsert/get shape mirrors `version_grounding`
exactly (grounding_repo.py) — a re-run upserts rather than duplicating, and
`get` merges `model`/`checked_at`/`cited_content_hash` into the stored report
dict so the caller can pop `cited_content_hash` for the read-time stale
check (tested at the router layer in Task 2)."""

import os
import uuid

import asyncpg
import pytest

from backend.src.trust import artifact_repo, originality_repo, project_repo

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
    p = await project_repo.create_project(conn, owner_account_id=a, title="T")
    return p.id


async def _artifact_version(conn, project_id):
    art = await artifact_repo.create_artifact(
        conn, project_id=project_id, role="cornerstone", format="guide"
    )
    v = await artifact_repo.create_version(
        conn, artifact_id=art.id, content={"sections": []}, created_by_sub="owner-sub"
    )
    return v.id


async def test_get_returns_none_when_no_report_stored(conn):
    project_id = await _project(conn)
    version_id = await _artifact_version(conn, project_id)
    assert await originality_repo.get(conn, version_id=version_id, version_kind="artifact") is None


async def test_upsert_then_get_round_trips_the_report(conn):
    project_id = await _project(conn)
    version_id = await _artifact_version(conn, project_id)
    report = {
        "sections": [{"index": 0, "heading": "H", "overlap": "none", "note": None, "source_ref": None}],
        "summary": {"verbatim": 0, "paraphrase": 0, "clean": 1, "total": 1},
    }
    await originality_repo.upsert(
        conn,
        version_id=version_id,
        version_kind="artifact",
        report=report,
        model="m",
        cited_content_hash="h1",
    )
    got = await originality_repo.get(conn, version_id=version_id, version_kind="artifact")
    assert got is not None
    assert got["summary"] == {"verbatim": 0, "paraphrase": 0, "clean": 1, "total": 1}
    assert got["model"] == "m"
    assert got["cited_content_hash"] == "h1"


async def test_rerun_upserts_rather_than_duplicating(conn):
    project_id = await _project(conn)
    version_id = await _artifact_version(conn, project_id)
    report1 = {"sections": [], "summary": {"verbatim": 0, "paraphrase": 0, "clean": 0, "total": 0}}
    report2 = {"sections": [], "summary": {"verbatim": 1, "paraphrase": 0, "clean": 0, "total": 1}}
    await originality_repo.upsert(
        conn, version_id=version_id, version_kind="artifact", report=report1, model="m1", cited_content_hash="h1",
    )
    await originality_repo.upsert(
        conn, version_id=version_id, version_kind="artifact", report=report2, model="m2", cited_content_hash="h2",
    )
    rows = await conn.fetch(
        "SELECT model FROM version_originality WHERE version_id=$1 AND version_kind='artifact'",
        version_id,
    )
    assert len(rows) == 1
    assert rows[0]["model"] == "m2"


async def test_artifact_and_topic_kinds_are_independent_rows(conn):
    project_id = await _project(conn)
    version_id = await _artifact_version(conn, project_id)
    report = {"sections": [], "summary": {"verbatim": 0, "paraphrase": 0, "clean": 0, "total": 0}}
    await originality_repo.upsert(
        conn, version_id=version_id, version_kind="artifact", report=report, model="m", cited_content_hash="h",
    )
    assert await originality_repo.get(conn, version_id=version_id, version_kind="topic") is None
```

- [ ] **Step 4: Run it, confirm it fails on import**

Run: `cd backend && pytest tests/test_trust_originality_repo.py -v`
Expected: `ModuleNotFoundError: No module named 'backend.src.trust.originality_repo'` (or `ImportError`).

- [ ] **Step 5: Write `originality_repo.py`**

`backend/src/trust/originality_repo.py`:

```python
"""Persistence for the per-version LLM source-overlap originality report (B3
Part A). Keyed by (version_id, version_kind); a re-run upserts.
`cited_content_hash` lets the read layer flag a stored report stale when the
cited inputs changed — same mechanism, byte-for-byte, as grounding_repo.py."""

from __future__ import annotations

import json
from uuid import UUID

import asyncpg


async def upsert(
    conn: asyncpg.Connection,
    *,
    version_id: UUID,
    version_kind: str,
    report: dict,
    model: str,
    cited_content_hash: str,
) -> None:
    await conn.execute(
        """INSERT INTO version_originality (version_id, version_kind, report, model, cited_content_hash)
           VALUES ($1,$2,$3::jsonb,$4,$5)
           ON CONFLICT (version_id, version_kind)
           DO UPDATE SET report=EXCLUDED.report, model=EXCLUDED.model,
                         cited_content_hash=EXCLUDED.cited_content_hash, checked_at=now()""",
        version_id,
        version_kind,
        json.dumps(report),
        model,
        cited_content_hash,
    )


async def get(conn: asyncpg.Connection, *, version_id: UUID, version_kind: str) -> dict | None:
    row = await conn.fetchrow(
        "SELECT report, model, checked_at, cited_content_hash FROM version_originality "
        "WHERE version_id=$1 AND version_kind=$2",
        version_id,
        version_kind,
    )
    if row is None:
        return None
    return {
        **json.loads(row["report"]),
        "model": row["model"],
        "checked_at": row["checked_at"].isoformat(),
        "cited_content_hash": row["cited_content_hash"],
    }
```

- [ ] **Step 6: Run the repo test again, confirm it passes**

Run: `cd backend && pytest tests/test_trust_originality_repo.py -v`
Expected: 4 passed.

- [ ] **Step 7: Write the failing compute-path tests**

`backend/tests/test_trust_originality.py`:

```python
from unittest.mock import patch

from backend.src.trust import originality

_API_KEY = "sk-ant-" + "k" * 20


class _Src:  # minimal stand-in for a ProjectInput row
    def __init__(self, id, content):
        self.id, self.content = id, content


def test_uncited_section_is_clean_without_an_llm_call():
    sections = [{"heading": "H", "body": "Some prose.", "source_ids": []}]
    with patch("backend.src.trust.originality.generate_validated") as gv:
        rep, in_tok, out_tok = originality.generate_originality(
            sections=sections,
            sources=[_Src("s1", "text")],
            provider_id="anthropic",
            api_key=_API_KEY,
            model="m",
        )
        gv.assert_not_called()  # no cited source → nothing to compare against, no LLM call
    assert rep["summary"] == {"verbatim": 0, "paraphrase": 0, "clean": 1, "total": 1}
    assert rep["sections"][0]["overlap"] == "none"
    assert rep["sections"][0]["source_ref"] is None
    assert in_tok == 0 and out_tok == 0


def test_empty_body_section_is_clean_no_llm_call():
    sections = [{"heading": "H", "body": "   ", "source_ids": ["s1"]}]
    with patch("backend.src.trust.originality.generate_validated") as gv:
        rep, in_tok, out_tok = originality.generate_originality(
            sections=sections,
            sources=[_Src("s1", "text")],
            provider_id="anthropic",
            api_key=_API_KEY,
            model="m",
        )
        gv.assert_not_called()
    assert rep["sections"][0]["overlap"] == "none"
    assert in_tok == 0 and out_tok == 0


def test_cited_section_maps_the_model_label_back_to_the_real_source_id():
    sections = [{"heading": "H", "body": "Some prose.", "source_ids": ["s1"]}]

    class _Res:  # mimic ConformanceResult
        parsed = type(
            "P", (), {"overlap": "verbatim", "note": "matches S1 word for word", "source_ref": "S1"}
        )()
        total_input_tokens = 120
        total_output_tokens = 45

    with patch("backend.src.trust.originality.generate_validated", return_value=_Res()):
        rep, in_tok, out_tok = originality.generate_originality(
            sections=sections,
            sources=[_Src("s1", "src text")],
            provider_id="anthropic",
            api_key=_API_KEY,
            model="m",
        )
    sec = rep["sections"][0]
    assert sec["overlap"] == "verbatim"
    assert sec["source_ref"] == "s1"  # S1 label → real input id
    assert sec["note"] == "matches S1 word for word"
    assert rep["summary"] == {"verbatim": 1, "paraphrase": 0, "clean": 0, "total": 1}
    assert in_tok == 120 and out_tok == 45


def test_report_shape_keys():
    sections = [{"heading": "H", "body": "Some prose.", "source_ids": []}]
    rep, _in_tok, _out_tok = originality.generate_originality(
        sections=sections, sources=[], provider_id="anthropic", api_key=_API_KEY, model="claude-sonnet-4-6",
    )
    assert set(rep.keys()) == {"sections", "summary"}
    assert set(rep["sections"][0].keys()) == {"index", "heading", "overlap", "note", "source_ref"}
    assert rep["sections"][0]["index"] == 0
    assert set(rep["summary"].keys()) == {"verbatim", "paraphrase", "clean", "total"}


def test_unknown_overlap_value_normalizes_to_verbatim_fail_safe():
    # Mirrors grounding._coerce's philosophy: an unparseable verdict must
    # never silently pass as clean — it normalizes to the state that
    # surfaces for human review, the same conservative direction grounding
    # takes when it normalizes an unknown claim status to "unsupported".
    out = originality._coerce({"overlap": "totally_bogus", "note": None, "source_ref": None})
    assert out.overlap == "verbatim"


def test_build_originality_prompt_includes_labels_and_content_and_asks_about_only_cited_sources():
    p = originality.build_originality_prompt("Intro", "Some body text.", [("S1", "source content")])
    assert "S1" in p
    assert "source content" in p
    assert "Some body text." in p
    assert "Intro" in p
    assert "json" in p.lower()
    assert "verbatim" in p and "paraphrase" in p


def test_the_submitted_key_never_appears_in_logs(caplog):
    # ADR-001, compute-path proof — mirrors test_derivatives_generate.py's
    # caplog assertion. The endpoint/worker-level proof (job status payload)
    # is Task 2's test_status_payload_never_contains_the_key_on_success twin.
    sections = [{"heading": "H", "body": "Some prose.", "source_ids": ["s1"]}]

    class _Res:
        parsed = type("P", (), {"overlap": "none", "note": None, "source_ref": None})()
        total_input_tokens = total_output_tokens = 0

    with patch("backend.src.trust.originality.generate_validated", return_value=_Res()):
        originality.generate_originality(
            sections=sections,
            sources=[_Src("s1", "src text")],
            provider_id="anthropic",
            api_key=_API_KEY,
            model="m",
        )
    assert _API_KEY not in caplog.text
```

- [ ] **Step 8: Run it, confirm it fails on import**

Run: `cd backend && pytest tests/test_trust_originality.py -v`
Expected: `ModuleNotFoundError: No module named 'backend.src.trust.originality'`.

- [ ] **Step 9: Write `originality.py`**

`backend/src/trust/originality.py`:

```python
"""LLM source-overlap originality check (B3 Part A) — per section, ask
whether the section's text reproduces ONLY its own cited sources verbatim,
paraphrases them closely, or is synthesized in the author's own words.
Explicitly NOT an against-the-web plagiarism scan (the LLM seam is
model-only and cannot search the web — see the design spec's "Why"). Reuses
the generate.py conformance loop exactly as grounding.py does; the caller
(tasks.py) resolves the key and persists the result."""

from __future__ import annotations

from pydantic import BaseModel

from .generate import LLMRequest, build_provider, generate_validated, parse_json_response

_MAX_TOKENS = 8192
_MAX_REPAIRS = 2
_OVERLAPS = {"none", "paraphrase", "verbatim"}


class _OriginalityOut(BaseModel):
    overlap: str
    note: str | None = None
    source_ref: str | None = None


def build_originality_prompt(heading: str, body: str, cited: list[tuple[str, str]]) -> str:
    src = "\n\n".join(f'[{label}]\n"""\n{content}\n"""' for label, content in cited)
    return (
        "You are checking whether a section closely reproduces its OWN cited sources — "
        "NOT checking the whole internet, ONLY the sources listed below.\n"
        f"SECTION: {heading}\n\nSOURCES (cite ONLY these labels):\n{src}\n\n"
        f'SECTION TEXT:\n"""\n{body}\n"""\n\n'
        "Decide whether the section text reproduces a cited source verbatim or near-verbatim "
        "(word-for-word, or with only trivial changes), is a paraphrase that stays close to the "
        "source's phrasing/structure, or is synthesized in the author's own words (no meaningful "
        "overlap). Classify the WHOLE section as exactly one of 'verbatim', 'paraphrase', or 'none'. "
        "If 'verbatim' or 'paraphrase', name the ONE source label it overlaps most and give a "
        "one-line reason.\n"
        'Return ONLY JSON: {"overlap":"none|paraphrase|verbatim","note":"<one line or null>",'
        '"source_ref":"<a source label like S1, or null>"}'
    )


def _coerce(data) -> _OriginalityOut:
    out = _OriginalityOut.model_validate(data)
    if out.overlap not in _OVERLAPS:
        # Fail-safe: an unparseable verdict surfaces for human review rather
        # than silently passing as clean — mirrors grounding._coerce
        # normalizing an unknown claim status to "unsupported" (the state
        # that demands attention, not the state that waves it through).
        out.overlap = "verbatim"
    return out


def _source_content(sources, sid: str) -> str:
    for s in sources:
        if str(s.id) == sid:
            return s.content or ""
    return ""


def generate_originality(*, sections, sources, provider_id, api_key, model) -> tuple[dict, int, int]:
    """Per section, classify whether it overlaps ONLY that section's cited
    sources as 'none' | 'paraphrase' | 'verbatim'. A section citing no live
    source (or with an empty body) is 'none' with no LLM call — there is
    nothing to compare it against.

    Returns `(report, input_tokens, output_tokens)` — the token totals are
    summed across every per-section `generate_validated` call (sections that
    skip the LLM call contribute 0), for the caller to meter managed usage —
    same contract as grounding.generate_grounding."""
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    id_to_label = {v: k for k, v in by_label.items()}
    out_sections: list[dict] = []
    totals = {"verbatim": 0, "paraphrase": 0, "clean": 0}
    input_tokens = 0
    output_tokens = 0

    for idx, sec in enumerate(sections):
        heading = sec.get("heading") or ""
        body = sec.get("body") or ""
        live_ids = [sid for sid in (sec.get("source_ids") or []) if sid in id_to_label]
        if not live_ids or not body.strip():
            overlap, note, source_ref = "none", None, None
        else:
            cited = [(id_to_label[sid], _source_content(sources, sid)) for sid in live_ids]
            provider = build_provider(provider_id, api_key=api_key, model=model)
            req = LLMRequest(
                prompt=build_originality_prompt(heading, body, cited),
                max_tokens=_MAX_TOKENS,
                response_format="json",
            )

            def _validate(text: str) -> _OriginalityOut:
                return _coerce(parse_json_response(text))

            res = generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS)
            input_tokens += res.total_input_tokens
            output_tokens += res.total_output_tokens
            overlap = res.parsed.overlap
            note = res.parsed.note
            label = res.parsed.source_ref
            source_ref = by_label.get(label) if label in by_label else None

        summary_key = "clean" if overlap == "none" else overlap
        totals[summary_key] = totals.get(summary_key, 0) + 1
        out_sections.append(
            {"index": idx, "heading": heading, "overlap": overlap, "note": note, "source_ref": source_ref}
        )

    report = {
        "sections": out_sections,
        "summary": {
            "verbatim": totals["verbatim"],
            "paraphrase": totals["paraphrase"],
            "clean": totals["clean"],
            "total": len(out_sections),
        },
    }
    return report, input_tokens, output_tokens
```

- [ ] **Step 10: Run the compute-path tests again, confirm they pass**

Run: `cd backend && pytest tests/test_trust_originality.py -v`
Expected: 7 passed.

- [ ] **Step 11: Format and commit**

Run: `cd backend && ruff format src/trust/originality_repo.py src/trust/originality.py alembic/versions/0022_version_originality.py tests/test_trust_originality_repo.py tests/test_trust_originality.py`

```bash
git add backend/alembic/versions/0022_version_originality.py backend/src/trust/originality_repo.py backend/src/trust/originality.py backend/tests/test_trust_originality_repo.py backend/tests/test_trust_originality.py
git commit -m "feat(trust): originality data model + LLM source-overlap compute (B3 Part A T1)"
```

---

### Task 2: Backend originality endpoints + worker

**Files:**
- Modify: `backend/src/trust/tasks.py:41-54` (imports), append `_run_originality_check`/`originality_check_task` after `grounding_check_task` (currently ends at line 1251)
- Modify: `backend/src/trust/router.py:24-53` (imports), append `originality_check_version`/`originality_check_topic_version` endpoints after `grounding_check_topic_version` (currently ends at line 590), and edit the two `GET` version-detail handlers (artifact: `router.py:299-347`, topic: `router.py:1177-1230`) to attach `q["originality"]`
- Test: `backend/tests/test_trust_originality_task.py`
- Test: `backend/tests/test_trust_originality_endpoint.py`

**Interfaces:**
- Consumes: `originality.generate_originality` and `originality_repo.{upsert,get}` from Task 1; `backend.src.trust.tasks.{cited_content_hash, _redis_client, _db_connect, _record_trust_usage}` (existing, same module); `backend.src.generate.tasks.{_byok_redis_key, _job_status_redis_key, _shred_envelope, _write_status}` (existing); `backend.src.billing.access.{resolve_managed_access, over_cap}`, `backend.src.billing.vault.get_managed_key` (existing); `backend.src.core.byok_envelope.{encrypt_api_key, decrypt_api_key, parse_master_key}` (existing).
- Produces: Celery task `originality_check_task(*, job_id, version_id, version_kind, provider_id, model, managed, recorded_by_sub) -> None` (registered as `"trust.originality_check"`) and its async body `_run_originality_check(...)`. Endpoints `POST /api/v1/trust/artifacts/versions/{version_id}/originality-check` and `POST /api/v1/trust/topic-versions/{version_id}/originality-check`, both `schemas.DraftGenerateIn` body → `schemas.VersionGenerateJobOut` (202). `GET /api/v1/trust/versions/{id}` and `GET /api/v1/trust/topic-versions/{id}` now include `quality["originality"]` (a dict shaped like `originality_repo.get`'s return with `cited_content_hash` popped and `stale: bool` added, or `null`) — consumed by Task 4's mobile `trustClient`.

- [ ] **Step 1: Write the failing worker test**

`backend/tests/test_trust_originality_task.py`:

```python
"""TDD for the originality-check Celery task (B3 T2). `originality_check_task`
/ its async body `_run_originality_check` is the worker side of `POST
.../artifacts/versions/{version_id}/originality-check` and `POST
.../topic-versions/{version_id}/originality-check` — it resolves the
provider key (BYOK envelope decrypt, or the managed vault key), audits an
existing version's sections against the project's live sources, and upserts
the report into `version_originality`. Byte-for-byte mirror of
`test_trust_grounding_task.py`'s harness for `_run_grounding_check`.

ADR-001 is non-negotiable here too: the BYOK key must NEVER appear in the
serialized status payload, and the encrypted envelope must be deleted from
Redis after the run on both the success and failure paths.
"""

from __future__ import annotations

import json
import os
import uuid
from unittest.mock import patch

import asyncpg
import fakeredis.aioredis
import pytest
from wegofwd_llm.errors import LLMSchemaError

from backend.config import settings
from backend.src.billing import pricing
from backend.src.core.byok_envelope import encrypt_api_key, parse_master_key
from backend.src.generate.tasks import _byok_redis_key, _job_status_redis_key
from backend.src.trust import artifact_repo, originality_repo, project_repo
from backend.src.trust import tasks as trust_tasks
from backend.tests.helpers import fake_provider

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not DSN, reason="no DB")]

_MASTER_KEY = parse_master_key(settings.byok_master_key)
_API_KEY = "sk-ant-" + "k" * 20

_GOOD = json.dumps({"overlap": "verbatim", "note": "matches S1 nearly word for word", "source_ref": "S1"})


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


@pytest.fixture
async def fake_redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=False)
    try:
        yield r
    finally:
        await r.aclose()


@pytest.fixture(autouse=True)
def _patch_redis_client(fake_redis):
    with patch("backend.src.trust.tasks._redis_client", return_value=fake_redis):
        yield


class _NoCloseConn:
    def __init__(self, inner):
        self._inner = inner

    def __getattr__(self, name):
        return getattr(self._inner, name)

    async def close(self):
        pass


@pytest.fixture(autouse=True)
def _patch_db_connect(conn):
    async def _fake_connect():
        return _NoCloseConn(conn)

    with patch("backend.src.trust.tasks._db_connect", _fake_connect):
        yield


async def _project_with_version(conn):
    a = await conn.fetchval(
        "INSERT INTO account (idp_sub) VALUES ($1) RETURNING id", f"s-{uuid.uuid4()}"
    )
    p = await project_repo.create_project(
        conn, owner_account_id=a, title="Guide", topic="stormwater", audience="engineers", goal="size pipes",
    )
    inp = await project_repo.add_input(
        conn, project_id=p.id, kind="note", title="N", content="Pipes are sized for the 10-year storm.",
    )
    art = await artifact_repo.create_artifact(conn, project_id=p.id, role="cornerstone", format="guide")
    v = await artifact_repo.create_version(
        conn,
        artifact_id=art.id,
        content={
            "sections": [
                {
                    "heading": "Design storm",
                    "body": "Pipes are sized for the 10-year storm.",
                    "source_ids": [str(inp.id)],
                }
            ]
        },
        created_by_sub="owner-sub",
    )
    return v.id


async def _seed_byok_envelope(fake_redis, job_id: uuid.UUID, key: str = _API_KEY) -> None:
    envelope = encrypt_api_key(_MASTER_KEY, str(job_id), key)
    await fake_redis.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)


async def _status(fake_redis, job_id: uuid.UUID) -> dict:
    raw = await fake_redis.get(_job_status_redis_key(job_id))
    assert raw is not None, "no status row written"
    return json.loads(raw)


# ── Happy path ────────────────────────────────────────────────────────────────


async def test_task_upserts_report_and_writes_done(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.originality.build_provider", return_value=fake_provider(text=_GOOD)
    ):
        await trust_tasks._run_originality_check(
            job_id=job_id,
            version_id=version_id,
            version_kind="artifact",
            provider_id="anthropic",
            model="m",
            managed=False,
            recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    assert body["result"] == {"version_id": str(version_id), "version_kind": "artifact"}

    stored = await originality_repo.get(conn, version_id=version_id, version_kind="artifact")
    assert stored is not None
    assert stored["summary"]["verbatim"] == 1


async def test_task_uses_the_managed_vault_key_when_managed(conn, fake_redis, monkeypatch):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch(
        "backend.src.trust.originality.build_provider", return_value=fake_provider(text=_GOOD)
    ):
        await trust_tasks._run_originality_check(
            job_id=job_id, version_id=version_id, version_kind="artifact",
            provider_id="anthropic", model="m", managed=True, recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"


# ── Failure path ──────────────────────────────────────────────────────────────


async def test_unknown_version_writes_failed_status(conn, fake_redis):
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    await trust_tasks._run_originality_check(
        job_id=job_id, version_id=uuid.uuid4(), version_kind="artifact",
        provider_id="anthropic", model="m", managed=False, recorded_by_sub="owner-sub",
    )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "failed"
    assert body["error"] == "version not found"


async def test_provider_error_writes_failed_status(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.originality.build_provider", side_effect=LLMSchemaError("bad json")
    ):
        await trust_tasks._run_originality_check(
            job_id=job_id, version_id=version_id, version_kind="artifact",
            provider_id="anthropic", model="m", managed=False, recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "failed"
    stored = await originality_repo.get(conn, version_id=version_id, version_kind="artifact")
    assert stored is None


# ── ADR-001: the key never leaks into the status payload ──────────────────────


async def test_status_payload_never_contains_the_key_on_success(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.originality.build_provider", return_value=fake_provider(text=_GOOD)
    ):
        await trust_tasks._run_originality_check(
            job_id=job_id, version_id=version_id, version_kind="artifact",
            provider_id="anthropic", model="m", managed=False, recorded_by_sub="owner-sub",
        )

    raw = await fake_redis.get(_job_status_redis_key(job_id))
    assert _API_KEY not in raw.decode("utf-8")


# ── Envelope shredding ──────────────────────────────────────────────────────────


async def test_envelope_deleted_after_success(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.originality.build_provider", return_value=fake_provider(text=_GOOD)
    ):
        await trust_tasks._run_originality_check(
            job_id=job_id, version_id=version_id, version_kind="artifact",
            provider_id="anthropic", model="m", managed=False, recorded_by_sub="owner-sub",
        )

    assert await fake_redis.get(_byok_redis_key(job_id)) is None


async def test_envelope_deleted_after_failure(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.originality.build_provider", side_effect=LLMSchemaError("bad json")
    ):
        await trust_tasks._run_originality_check(
            job_id=job_id, version_id=version_id, version_kind="artifact",
            provider_id="anthropic", model="m", managed=False, recorded_by_sub="owner-sub",
        )

    assert await fake_redis.get(_byok_redis_key(job_id)) is None


# ── Re-run upserts rather than duplicating ───────────────────────────────────


async def test_rerun_upserts_the_same_row(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id_1 = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id_1)
    with patch(
        "backend.src.trust.originality.build_provider", return_value=fake_provider(text=_GOOD)
    ):
        await trust_tasks._run_originality_check(
            job_id=job_id_1, version_id=version_id, version_kind="artifact",
            provider_id="anthropic", model="m", managed=False, recorded_by_sub="owner-sub",
        )

    job_id_2 = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id_2)
    with patch(
        "backend.src.trust.originality.build_provider", return_value=fake_provider(text=_GOOD)
    ):
        await trust_tasks._run_originality_check(
            job_id=job_id_2, version_id=version_id, version_kind="artifact",
            provider_id="anthropic", model="m2", managed=False, recorded_by_sub="owner-sub",
        )

    rows = await conn.fetch(
        "SELECT model FROM version_originality WHERE version_id=$1 AND version_kind='artifact'",
        version_id,
    )
    assert len(rows) == 1
    assert rows[0]["model"] == "m2"


# ── The Celery task wrapper itself ──────────────────────────────────────────────


def test_originality_check_task_registered():
    assert "trust.originality_check" in trust_tasks.celery_app.tasks


def test_originality_check_task_wraps_run_originality_check_via_asyncio_run():
    calls: dict = {}

    async def _fake_run(**kwargs):
        calls.update(kwargs)

    with patch("backend.src.trust.tasks._run_originality_check", _fake_run):
        trust_tasks.originality_check_task.apply(
            kwargs={
                "job_id": "11111111-1111-1111-1111-111111111111",
                "version_id": "22222222-2222-2222-2222-222222222222",
                "version_kind": "artifact",
                "provider_id": "anthropic",
                "model": "m",
                "managed": False,
                "recorded_by_sub": "sub-1",
            }
        ).get()

    assert str(calls["version_id"]) == "22222222-2222-2222-2222-222222222222"
    assert calls["version_kind"] == "artifact"
    assert calls["managed"] is False
    assert calls["recorded_by_sub"] == "sub-1"
    assert str(calls["job_id"]) == "11111111-1111-1111-1111-111111111111"


# ── Managed usage metering ────────────────────────────────────────────────────


async def _usage_events(conn, *, idp_sub: str) -> list[dict]:
    rows = await conn.fetch(
        "SELECT ue.* FROM usage_event ue JOIN account a ON a.id = ue.account_id WHERE a.idp_sub = $1",
        idp_sub,
    )
    return [dict(r) for r in rows]


async def _all_usage_events(conn) -> list[dict]:
    rows = await conn.fetch("SELECT * FROM usage_event")
    return [dict(r) for r in rows]


async def test_managed_originality_check_records_one_usage_event_with_observed_tokens(
    conn, fake_redis, monkeypatch
):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    monkeypatch.setattr(settings, "managed_anthropic_api_key", _API_KEY)

    with patch(
        "backend.src.trust.originality.build_provider", return_value=fake_provider(text=_GOOD)
    ):
        await trust_tasks._run_originality_check(
            job_id=job_id, version_id=version_id, version_kind="artifact",
            provider_id="anthropic", model="m", managed=True, recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"

    events = await _usage_events(conn, idp_sub="owner-sub")
    assert len(events) == 1
    ev = events[0]
    assert ev["provider"] == "anthropic"
    assert ev["model"] == "m"
    assert ev["input_tokens"] == 100
    assert ev["output_tokens"] == 500
    assert ev["cost_micros"] == pricing.cost_micros("anthropic", "m", 100, 500)
    assert ev["job_id"] == job_id


async def test_byok_originality_check_records_zero_usage_events(conn, fake_redis):
    version_id = await _project_with_version(conn)
    job_id = uuid.uuid4()
    await _seed_byok_envelope(fake_redis, job_id)

    with patch(
        "backend.src.trust.originality.build_provider", return_value=fake_provider(text=_GOOD)
    ):
        await trust_tasks._run_originality_check(
            job_id=job_id, version_id=version_id, version_kind="artifact",
            provider_id="anthropic", model="m", managed=False, recorded_by_sub="owner-sub",
        )

    body = await _status(fake_redis, job_id)
    assert body["status"] == "done"
    assert await _all_usage_events(conn) == []
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && pytest tests/test_trust_originality_task.py -v`
Expected: `AttributeError: module 'backend.src.trust.tasks' has no attribute '_run_originality_check'`.

- [ ] **Step 3: Add the worker to `tasks.py`**

Edit `backend/src/trust/tasks.py:48` (the `from . import ...` line) — change:

```python
from . import artifact_repo, book_gen, generation_job_repo, grounding_repo, project_repo, topic_repo
```

to:

```python
from . import (
    artifact_repo,
    book_gen,
    generation_job_repo,
    grounding_repo,
    originality_repo,
    project_repo,
    topic_repo,
)
```

Edit `backend/src/trust/tasks.py:52` — change:

```python
from .grounding import generate_grounding
```

to:

```python
from .grounding import generate_grounding
from .originality import generate_originality
```

Append after `grounding_check_task` (end of file, currently line 1251):

```python


async def _run_originality_check(
    *,
    job_id: uuid.UUID,
    version_id: uuid.UUID,
    version_kind: str,
    provider_id: str,
    model: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    """Do the actual work for one originality-check job (B3 T2).

    Byte-for-byte mirror of `_run_grounding_check`'s shape (key resolution,
    the `running` write, shred-on-every-exit-path, managed metering) —
    deltas are: `generate_originality` replaces `generate_grounding`, and
    the result is upserted into `version_originality` instead of
    `version_grounding`. Never raises — every exit path (success, a known
    LLM failure, or an unexpected error) writes a status row and shreds the
    BYOK envelope.
    """
    r = _redis_client()
    api_key: str | None = None
    try:
        raw = await r.get(_job_status_redis_key(job_id))
        if raw is not None:
            try:
                already = json.loads(raw).get("status")
            except (json.JSONDecodeError, AttributeError):
                already = None
            if already == "done":
                return

        if managed:
            api_key = get_managed_key(provider_id)
            if not api_key:
                log.warning("managed_key_missing", job_id=str(job_id), provider=provider_id)
                await _write_status(r, job_id, "failed", error="managed generation unavailable")
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

        conn = await _db_connect()
        try:
            if version_kind == "artifact":
                v = await artifact_repo.get_version(conn, version_id=version_id)
                if v is None:
                    await _write_status(r, job_id, "failed", error="version not found")
                    return
                project_id = await project_id_for_version(conn, version_id=version_id)
            else:
                v = await topic_repo.get_topic_version(conn, topic_version_id=version_id)
                if v is None:
                    await _write_status(r, job_id, "failed", error="version not found")
                    return
                project_id = await topic_repo.project_id_for_topic_version(
                    conn, topic_version_id=version_id
                )
            if project_id is None:
                await _write_status(r, job_id, "failed", error="version not found")
                return

            sections = (v.content or {}).get("sections", [])
            sources = await project_repo.list_inputs(conn, project_id=project_id)

            resolved_model = model or settings.anthropic_default_model
            await _write_status(r, job_id, "running")
            try:
                report, in_tok, out_tok = await asyncio.to_thread(
                    generate_originality,
                    sections=sections,
                    sources=sources,
                    provider_id=provider_id,
                    api_key=api_key,
                    model=resolved_model,
                )
            except LLMSchemaError:
                log.warning("originality_check_failed", job_id=str(job_id), reason="schema")
                await _write_status(
                    r, job_id, "failed", error="generated originality report failed validation"
                )
                return
            except LLMAuthError:
                log.warning("originality_check_failed", job_id=str(job_id), reason="auth")
                await _write_status(
                    r, job_id, "failed",
                    error="The API key was rejected by the provider. Check it in Settings.",
                )
                return
            except LLMRateLimitError:
                log.warning("originality_check_failed", job_id=str(job_id), reason="rate_limit")
                await _write_status(
                    r, job_id, "failed",
                    error="The provider is rate-limiting requests. Try again shortly.",
                )
                return
            except LLMError:
                log.warning("originality_check_failed", job_id=str(job_id), reason="llm_error")
                await _write_status(r, job_id, "failed", error="originality check failed")
                return
            except Exception:
                log.warning("originality_check_failed", job_id=str(job_id), reason="unexpected")
                await _write_status(r, job_id, "failed", error="originality check failed")
                return

            cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
            await originality_repo.upsert(
                conn,
                version_id=version_id,
                version_kind=version_kind,
                report=report,
                model=resolved_model,
                cited_content_hash=cited_content_hash(sources, cited),
            )

            if managed:
                try:
                    acct = await accounts_repo.get_or_create_account(
                        conn, idp_sub=recorded_by_sub, email=None
                    )
                    await _record_trust_usage(
                        conn,
                        account_id=acct.id,
                        provider=provider_id,
                        model=resolved_model,
                        input_tokens=in_tok,
                        output_tokens=out_tok,
                        job_id=job_id,
                    )
                except Exception:
                    log.warning("trust_managed_usage_record_failed", job_id=str(job_id))
        finally:
            await conn.close()

        await _write_status(
            r, job_id, "done", result={"version_id": str(version_id), "version_kind": version_kind},
        )
    except Exception:
        log.warning("trust_originality_check_task_failed", job_id=str(job_id), reason="unexpected")
        try:
            await _write_status(r, job_id, "failed", error="originality check failed")
        except Exception:
            log.warning("status_write_failed", job_id=str(job_id))
    finally:
        if api_key is not None:
            del api_key
        await _shred_envelope(r, job_id)
        await r.aclose()


@celery_app.task(bind=True, name="trust.originality_check")
def originality_check_task(
    self,
    *,
    job_id: str,
    version_id: str,
    version_kind: str,
    provider_id: str,
    model: str | None,
    managed: bool,
    recorded_by_sub: str,
) -> None:
    asyncio.run(
        _run_originality_check(
            job_id=uuid.UUID(job_id),
            version_id=uuid.UUID(version_id),
            version_kind=version_kind,
            provider_id=provider_id,
            model=model,
            managed=managed,
            recorded_by_sub=recorded_by_sub,
        )
    )
```

- [ ] **Step 4: Run the worker test, confirm it passes**

Run: `cd backend && pytest tests/test_trust_originality_task.py -v`
Expected: 12 passed.

- [ ] **Step 5: Write the failing endpoint test**

`backend/tests/test_trust_originality_endpoint.py`:

```python
"""TDD for the originality-check endpoints + `version_originality`
persistence (B3 T2): `POST .../artifacts/versions/{version_id}/originality-check`
and `POST .../topic-versions/{version_id}/originality-check` submit an async
job (mirrors `grounding-check`'s eligibility/envelope/enqueue shape —
owner-only, billable) whose worker (`originality_check_task`) upserts a
stored report into `version_originality`. `GET /versions/{id}` /
`GET /topic-versions/{id}` then surface that stored report (+ a `stale`
flag) as `quality.originality`.
"""

from __future__ import annotations

import os
import uuid
from unittest.mock import patch

import asyncpg
import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal
from backend.src.core.redis_dep import get_redis
from backend.src.trust import originality_repo, project_repo
from backend.src.trust import tasks as trust_tasks
from backend.src.trust import topic_repo as trust_topic_repo

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


def _artifact_version_with_source(c):
    pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
    inp = c.post(
        f"/api/v1/trust/projects/{pid}/inputs",
        json={"kind": "note", "title": "Src", "content": "some source content"},
    ).json()
    art = c.post(
        f"/api/v1/trust/projects/{pid}/artifacts", json={"role": "cornerstone", "format": "guide"},
    ).json()
    content = {
        "sections": [{"heading": "A", "body": "The cat sat on the mat.", "source_ids": [inp["id"]]}]
    }
    ver = c.post(f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": content}).json()
    return pid, ver["id"], inp["id"]


def test_owner_submits_originality_check_returns_202_and_enqueues():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        _pid, vid, _iid = _artifact_version_with_source(c)
        key = "sk-ant-" + "e" * 20

        with patch("backend.src.trust.router.originality_check_task.delay") as mock_delay:
            r = c.post(
                f"/api/v1/trust/artifacts/versions/{vid}/originality-check", json={"api_key": key},
            )
        assert r.status_code == 202, r.text
        assert key not in r.text  # ADR-001: the submitted key never leaks into the response
        body = r.json()
        assert body["status"] == "queued"

        mock_delay.assert_called_once()
        kwargs = mock_delay.call_args.kwargs
        assert kwargs["job_id"] == body["job_id"]
        assert kwargs["version_id"] == vid
        assert kwargs["version_kind"] == "artifact"
        assert kwargs["managed"] is False
        assert kwargs["recorded_by_sub"] == owner
        assert "api_key" not in kwargs  # ADR-001: the key never rides along in task args

        job = c.get(f"/api/v1/jobs/{body['job_id']}").json()
        assert job["status"] == "queued"


async def _insert_topic_version(project_id, owner_sub, input_id):
    conn = await asyncpg.connect(DSN)
    try:
        v = await trust_topic_repo.create_topic_version(
            conn,
            project_id=uuid.UUID(project_id),
            topic_id="t1",
            title="T1",
            source_ids=[input_id],
            content={"sections": [{"heading": "H", "body": "b", "source_ids": [input_id]}]},
            created_by_sub=owner_sub,
        )
        return str(v.id)
    finally:
        await conn.close()


def test_owner_submits_topic_originality_check_returns_202_with_topic_kind():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        inp = c.post(
            f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "title": "Src", "content": "source"},
        ).json()

        import asyncio

        tvid = asyncio.run(_insert_topic_version(pid, owner, inp["id"]))

        with patch("backend.src.trust.router.originality_check_task.delay") as mock_delay:
            r = c.post(
                f"/api/v1/trust/topic-versions/{tvid}/originality-check", json={"api_key": "sk-ant-" + "e" * 20},
            )
        assert r.status_code == 202, r.text
        kwargs = mock_delay.call_args.kwargs
        assert kwargs["version_id"] == tvid
        assert kwargs["version_kind"] == "topic"
        assert kwargs["recorded_by_sub"] == owner


def test_originality_check_unknown_version_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        r = c.post(
            f"/api/v1/trust/artifacts/versions/{uuid.uuid4()}/originality-check",
            json={"api_key": "sk-ant-" + "e" * 20},
        )
        assert r.status_code == 404


def test_reviewer_cannot_submit_originality_check_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, vid, _iid = _artifact_version_with_source(c)

        expert = f"e-{uuid.uuid4()}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert})
        _as(f"e-{uuid.uuid4()}", expert)
        c.post("/api/v1/trust/session/sync")

        r = c.post(
            f"/api/v1/trust/artifacts/versions/{vid}/originality-check", json={"api_key": "sk-ant-" + "e" * 20},
        )
        assert r.status_code == 403


async def _upsert_report(version_id, version_kind, sources, cited_ids, *, model="m"):
    conn = await asyncpg.connect(DSN)
    try:
        report = {
            "sections": [{"index": 0, "heading": "H", "overlap": "none", "note": None, "source_ref": None}],
            "summary": {"verbatim": 0, "paraphrase": 0, "clean": 1, "total": 1},
        }
        await originality_repo.upsert(
            conn,
            version_id=uuid.UUID(version_id),
            version_kind=version_kind,
            report=report,
            model=model,
            cited_content_hash=trust_tasks.cited_content_hash(sources, cited_ids),
        )
    finally:
        await conn.close()


async def _set_input_content_hash(input_id, new_hash):
    conn = await asyncpg.connect(DSN)
    try:
        await conn.execute(
            "UPDATE project_input SET content_hash = $2 WHERE id = $1", uuid.UUID(input_id), new_hash,
        )
    finally:
        await conn.close()


async def _sources_for(project_id):
    conn = await asyncpg.connect(DSN)
    try:
        return await project_repo.list_inputs(conn, project_id=uuid.UUID(project_id))
    finally:
        await conn.close()


def test_stored_originality_surfaces_on_read_and_flips_stale():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, vid, iid = _artifact_version_with_source(c)

        import asyncio

        sources = asyncio.run(_sources_for(pid))
        asyncio.run(_upsert_report(vid, "artifact", sources, {iid}))

        r = c.get(f"/api/v1/trust/versions/{vid}")
        assert r.status_code == 200
        o = r.json()["quality"]["originality"]
        assert o is not None
        assert o["stale"] is False
        assert "cited_content_hash" not in o  # popped before returning

        asyncio.run(_set_input_content_hash(iid, "sha256:changed"))

        r2 = c.get(f"/api/v1/trust/versions/{vid}")
        o2 = r2.json()["quality"]["originality"]
        assert o2 is not None
        assert o2["stale"] is True


def test_no_stored_originality_is_none():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        _pid, vid, _iid = _artifact_version_with_source(c)

        r = c.get(f"/api/v1/trust/versions/{vid}")
        assert r.json()["quality"]["originality"] is None
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd backend && pytest tests/test_trust_originality_endpoint.py -v`
Expected: `AttributeError: module 'backend.src.trust.router' has no attribute 'originality_check_task'` (or a 404 from an unregistered route).

- [ ] **Step 7: Add the endpoints + read-time attach to `router.py`**

Edit `backend/src/trust/router.py:24-37` (the `from . import (...)` block) — change:

```python
from . import (
    approval_repo,
    artifact_repo,
    book_gen,
    feedback_repo,
    generation_job_repo,
    grounding_repo,
    membership_repo,
    project_repo,
    schemas,
    topic_approval_repo,
    topic_feedback_repo,
    topic_repo,
)
```

to:

```python
from . import (
    approval_repo,
    artifact_repo,
    book_gen,
    feedback_repo,
    generation_job_repo,
    grounding_repo,
    membership_repo,
    originality_repo,
    project_repo,
    schemas,
    topic_approval_repo,
    topic_feedback_repo,
    topic_repo,
)
```

Edit `backend/src/trust/router.py:46-53` (the `from .tasks import (...)` block) — change:

```python
from .tasks import (
    cited_content_hash,
    generate_book_task,
    generate_topic_task,
    generate_version_task,
    grounding_check_task,
    suggest_toc_task,
)
```

to:

```python
from .tasks import (
    cited_content_hash,
    generate_book_task,
    generate_topic_task,
    generate_version_task,
    grounding_check_task,
    originality_check_task,
    suggest_toc_task,
)
```

Edit `backend/src/trust/router.py:319-324` (the artifact `GET /versions/{version_id}` grounding block, inside `get_version`) — change:

```python
    g = await grounding_repo.get(conn, version_id=version_id, version_kind="artifact")
    if g is not None:
        stored_hash = g.pop("cited_content_hash")
        cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
        g["stale"] = stored_hash != cited_content_hash(live, cited)
    q["grounding"] = g
```

to:

```python
    g = await grounding_repo.get(conn, version_id=version_id, version_kind="artifact")
    if g is not None:
        stored_hash = g.pop("cited_content_hash")
        cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
        g["stale"] = stored_hash != cited_content_hash(live, cited)
    q["grounding"] = g
    o = await originality_repo.get(conn, version_id=version_id, version_kind="artifact")
    if o is not None:
        o_stored_hash = o.pop("cited_content_hash")
        o_cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
        o["stale"] = o_stored_hash != cited_content_hash(live, o_cited)
    q["originality"] = o
```

Edit `backend/src/trust/router.py:1200-1205` (the topic `GET /topic-versions/{topic_version_id}` grounding block, inside `get_topic_version`) — change:

```python
    g = await grounding_repo.get(conn, version_id=topic_version_id, version_kind="topic")
    if g is not None:
        stored_hash = g.pop("cited_content_hash")
        cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
        g["stale"] = stored_hash != cited_content_hash(live, cited)
    q["grounding"] = g
```

to:

```python
    g = await grounding_repo.get(conn, version_id=topic_version_id, version_kind="topic")
    if g is not None:
        stored_hash = g.pop("cited_content_hash")
        cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
        g["stale"] = stored_hash != cited_content_hash(live, cited)
    q["grounding"] = g
    o = await originality_repo.get(conn, version_id=topic_version_id, version_kind="topic")
    if o is not None:
        o_stored_hash = o.pop("cited_content_hash")
        o_cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
        o["stale"] = o_stored_hash != cited_content_hash(live, o_cited)
    q["originality"] = o
```

Append the two new endpoints right after `grounding_check_topic_version` (immediately before `@router.post("/projects/{project_id}/invitations", ...)`, currently `router.py:593`):

```python
@router.post(
    "/artifacts/versions/{version_id}/originality-check",
    response_model=schemas.VersionGenerateJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def originality_check_version(
    version_id: uuid.UUID,
    body: schemas.DraftGenerateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
    r: redis.Redis = Depends(get_redis),
) -> schemas.VersionGenerateJobOut:
    """Submit a source-overlap originality audit job for an existing artifact
    version (B3 T2 — async). Billable, so owner-only; checks ONLY the
    project's own cited sources, never the web (see the design spec). Byte-for-
    byte mirror of `grounding_check_version`'s eligibility/envelope/enqueue
    shape — the actual LLM call happens in `originality_check_task` (Celery).
    Poll `GET /api/v1/jobs/{job_id}` for the eventual `done`/`failed` status;
    on success the stored report is picked up by the next
    `GET /versions/{version_id}` read."""
    project_id = await project_id_for_version(conn, version_id=version_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))  # billable → owner only

    managed = body.api_key is None
    if managed:
        grant = await resolve_managed_access(
            conn, account_id=account.id, provider_id=body.provider_id, principal=principal
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
    model = body.model or settings.anthropic_default_model

    job_id = uuid.uuid4()

    if not managed:
        master_key = parse_master_key(settings.byok_master_key)
        envelope = encrypt_api_key(master_key, str(job_id), body.api_key)
        await r.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)

    await _write_status(r, job_id, "queued")

    originality_check_task.delay(
        job_id=str(job_id),
        version_id=str(version_id),
        version_kind="artifact",
        provider_id=body.provider_id,
        model=model,
        managed=managed,
        recorded_by_sub=principal.sub,
    )

    log.info(
        "originality_check_submitted",
        job_id=str(job_id),
        version_id=str(version_id),
        version_kind="artifact",
        managed=managed,
    )

    return schemas.VersionGenerateJobOut(job_id=str(job_id), status="queued")


@router.post(
    "/topic-versions/{version_id}/originality-check",
    response_model=schemas.VersionGenerateJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def originality_check_topic_version(
    version_id: uuid.UUID,
    body: schemas.DraftGenerateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
    r: redis.Redis = Depends(get_redis),
) -> schemas.VersionGenerateJobOut:
    """The topic-version twin of `originality_check_version` — same shape,
    `version_kind="topic"`."""
    project_id = await topic_repo.project_id_for_topic_version(conn, topic_version_id=version_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "topic version not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))  # billable → owner only

    managed = body.api_key is None
    if managed:
        grant = await resolve_managed_access(
            conn, account_id=account.id, provider_id=body.provider_id, principal=principal
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
    model = body.model or settings.anthropic_default_model

    job_id = uuid.uuid4()

    if not managed:
        master_key = parse_master_key(settings.byok_master_key)
        envelope = encrypt_api_key(master_key, str(job_id), body.api_key)
        await r.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)

    await _write_status(r, job_id, "queued")

    originality_check_task.delay(
        job_id=str(job_id),
        version_id=str(version_id),
        version_kind="topic",
        provider_id=body.provider_id,
        model=model,
        managed=managed,
        recorded_by_sub=principal.sub,
    )

    log.info(
        "originality_check_submitted",
        job_id=str(job_id),
        version_id=str(version_id),
        version_kind="topic",
        managed=managed,
    )

    return schemas.VersionGenerateJobOut(job_id=str(job_id), status="queued")
```

- [ ] **Step 8: Run the endpoint test, confirm it passes**

Run: `cd backend && pytest tests/test_trust_originality_endpoint.py -v`
Expected: 6 passed.

- [ ] **Step 9: Run the full trust suite to catch regressions in the two edited GET handlers**

Run: `cd backend && pytest tests/test_trust_grounding_endpoint.py tests/test_trust_router.py tests/test_trust_topic.py -v`
Expected: all passed (the grounding block is untouched; only a new `originality` sibling block was added).

- [ ] **Step 10: Format and commit**

Run: `cd backend && ruff format src/trust/tasks.py src/trust/router.py tests/test_trust_originality_task.py tests/test_trust_originality_endpoint.py`

```bash
git add backend/src/trust/tasks.py backend/src/trust/router.py backend/tests/test_trust_originality_task.py backend/tests/test_trust_originality_endpoint.py
git commit -m "feat(trust): originality-check endpoints + worker, surfaced as quality.originality (B3 Part A T2)"
```

---

### Task 3: Backend rights attestation

**Files:**
- Create: `backend/alembic/versions/0023_project_rights.py`
- Modify: `backend/src/trust/models.py` (the `Project` dataclass)
- Modify: `backend/src/trust/project_repo.py` (`_P`, `_project`, append `set_rights`)
- Modify: `backend/src/trust/schemas.py` (`ProjectOut`, add `RightsIn`)
- Modify: `backend/src/trust/router.py` (3 existing `ProjectOut(...)` call sites, 1 new endpoint)
- Test: `backend/tests/test_trust_rights_endpoint.py`

**Interfaces:**
- Consumes: `_require_role`, `_account`, `project_repo.get_project` (existing, same module/file).
- Produces: `project_repo.set_rights(conn, *, project_id, attested: bool, rights_holder: str | None) -> None`. `schemas.RightsIn { attested: bool, rights_holder: str | None }`. `ProjectOut` gains `rights_attested_at: datetime | None`, `rights_holder: str | None` — consumed by `ProjectDetailOut.project` (so `GET /projects/{id}` surfaces it) and by Task 5's mobile `ProjectView`. `PUT /api/v1/trust/projects/{project_id}/rights` → `schemas.ProjectOut`, owner-only, DISPLAY-ONLY (no export gate anywhere references it).
- **No compiler or export-router change**: `POST /api/v1/export` (`backend/src/export/router.py:79`) is stateless/key-free and compiles a client-supplied `book.json` with no `project_id` — confirmed by reading `backend/src/export/router.py` and `backend/src/export/trust.py` end to end. `compiler/src/colophon.ts:18-19` already reads `book.metadata.rights` with an author-based fallback. The `rights_holder` → `dc:rights` thread is entirely mobile-side (Task 5).

- [ ] **Step 1: Write the migration**

`backend/alembic/versions/0023_project_rights.py`:

```python
"""project.rights_attested_at / project.rights_holder — per-project rights
attestation (B3 Part B). DISPLAY-ONLY: never gates or blocks export. Chains
from 0022 (version_originality, B3 Part A)."""

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE project ADD COLUMN rights_attested_at TIMESTAMPTZ")
    op.execute("ALTER TABLE project ADD COLUMN rights_holder TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE project DROP COLUMN rights_holder")
    op.execute("ALTER TABLE project DROP COLUMN rights_attested_at")
```

- [ ] **Step 2: Apply the migration and confirm the new head**

Run: `cd backend && alembic upgrade head && alembic heads`
Expected: no errors; `alembic heads` prints `0023 (head)`.

- [ ] **Step 3: Write the failing endpoint test**

`backend/tests/test_trust_rights_endpoint.py`:

```python
"""TDD for `PUT /api/v1/trust/projects/{id}/rights` (B3 Part B) — owner-only
rights attestation, DISPLAY-ONLY (never gates/blocks export). Mirrors
test_trust_router.py's test_put_and_get_project_toc for the owner-only PUT
shape."""

from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal

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


def test_owner_attests_rights_and_it_surfaces_on_project_detail():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]

        r = c.put(
            f"/api/v1/trust/projects/{pid}/rights", json={"attested": True, "rights_holder": "Jane Doe"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["rights_holder"] == "Jane Doe"
        assert body["rights_attested_at"] is not None

        got = c.get(f"/api/v1/trust/projects/{pid}").json()["project"]
        assert got["rights_holder"] == "Jane Doe"
        assert got["rights_attested_at"] is not None


def test_withdrawing_attestation_clears_the_timestamp():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        c.put(f"/api/v1/trust/projects/{pid}/rights", json={"attested": True, "rights_holder": "Jane"})

        r = c.put(f"/api/v1/trust/projects/{pid}/rights", json={"attested": False})
        assert r.status_code == 200, r.text
        assert r.json()["rights_attested_at"] is None


def test_non_owner_cannot_attest_rights_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]

        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        r = c.put(
            f"/api/v1/trust/projects/{pid}/rights", json={"attested": True, "rights_holder": "Someone"},
        )
        assert r.status_code == 403


def test_new_project_starts_unattested():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        body = c.get(f"/api/v1/trust/projects/{pid}").json()["project"]
        assert body["rights_attested_at"] is None
        assert body["rights_holder"] is None
```

- [ ] **Step 4: Run it, confirm it fails**

Run: `cd backend && pytest tests/test_trust_rights_endpoint.py -v`
Expected: fails — either a 404/405 (route not registered) or a `KeyError`/`AssertionError` on the missing `rights_attested_at`/`rights_holder` keys in the response body.

- [ ] **Step 5: Add the fields to `models.py`**

Edit `backend/src/trust/models.py` — the `Project` dataclass currently ends:

```python
@dataclass(frozen=True)
class Project:
    id: str
    owner_account_id: str
    title: str
    topic: str | None
    audience: str | None
    goal: str | None
    status: str
    created_at: datetime | None
    updated_at: datetime | None
    toc: dict | None = None
```

Change to:

```python
@dataclass(frozen=True)
class Project:
    id: str
    owner_account_id: str
    title: str
    topic: str | None
    audience: str | None
    goal: str | None
    status: str
    created_at: datetime | None
    updated_at: datetime | None
    toc: dict | None = None
    rights_attested_at: datetime | None = None
    rights_holder: str | None = None
```

- [ ] **Step 6: Add the column + mapper + setter to `project_repo.py`**

Edit `backend/src/trust/project_repo.py:7` — change:

```python
_P = "id, owner_account_id, title, topic, audience, goal, status, created_at, updated_at, toc"
```

to:

```python
_P = (
    "id, owner_account_id, title, topic, audience, goal, status, created_at, updated_at, toc, "
    "rights_attested_at, rights_holder"
)
```

Edit `backend/src/trust/project_repo.py:11-28` (the `_project` mapper) — change:

```python
def _project(r) -> Project:
    return Project(
        **{
            k: r[k]
            for k in (
                "id",
                "owner_account_id",
                "title",
                "topic",
                "audience",
                "goal",
                "status",
                "created_at",
                "updated_at",
            )
        },
        toc=json.loads(r["toc"]) if r["toc"] is not None else None,
    )
```

to:

```python
def _project(r) -> Project:
    return Project(
        **{
            k: r[k]
            for k in (
                "id",
                "owner_account_id",
                "title",
                "topic",
                "audience",
                "goal",
                "status",
                "created_at",
                "updated_at",
                "rights_attested_at",
                "rights_holder",
            )
        },
        toc=json.loads(r["toc"]) if r["toc"] is not None else None,
    )
```

Append `set_rights` after `update_project_toc` (`backend/src/trust/project_repo.py:88-91`):

```python
async def set_rights(conn, *, project_id, attested: bool, rights_holder: str | None) -> None:
    """Owner-only rights attestation (B3 Part B) — DISPLAY-ONLY, never
    referenced by any export gate. `attested=True` stamps `now()`;
    `attested=False` withdraws the attestation (sets the timestamp back to
    null) without touching `rights_holder`'s stored value's caller-supplied
    replacement."""
    await conn.execute(
        "UPDATE project SET rights_attested_at = CASE WHEN $2 THEN now() ELSE NULL END, "
        "rights_holder = $3 WHERE id = $1",
        project_id,
        attested,
        rights_holder,
    )
```

- [ ] **Step 7: Add `RightsIn` and extend `ProjectOut` in `schemas.py`**

Edit `backend/src/trust/schemas.py:28-36` — change:

```python
class ProjectOut(BaseModel):
    id: str
    title: str
    topic: str | None
    audience: str | None
    goal: str | None
    status: str
    created_at: datetime | None
    toc: dict | None = None
```

to:

```python
class ProjectOut(BaseModel):
    id: str
    title: str
    topic: str | None
    audience: str | None
    goal: str | None
    status: str
    created_at: datetime | None
    toc: dict | None = None
    rights_attested_at: datetime | None = None
    rights_holder: str | None = None


class RightsIn(BaseModel):
    attested: bool
    rights_holder: str | None = Field(default=None, max_length=200)
```

- [ ] **Step 8: Thread the two fields through the 3 existing `ProjectOut(...)` call sites in `router.py`**

Edit `backend/src/trust/router.py:144-152` (`create_project`) — change:

```python
    return schemas.ProjectOut(
        id=str(p.id),
        title=p.title,
        topic=p.topic,
        audience=p.audience,
        goal=p.goal,
        status=p.status,
        created_at=p.created_at,
    )
```

to:

```python
    return schemas.ProjectOut(
        id=str(p.id),
        title=p.title,
        topic=p.topic,
        audience=p.audience,
        goal=p.goal,
        status=p.status,
        created_at=p.created_at,
        rights_attested_at=p.rights_attested_at,
        rights_holder=p.rights_holder,
    )
```

Edit `backend/src/trust/router.py:696-705` (`get_project`, inside `ProjectDetailOut(...)`) — change:

```python
        project=schemas.ProjectOut(
            id=str(p.id),
            title=p.title,
            topic=p.topic,
            audience=p.audience,
            goal=p.goal,
            status=p.status,
            created_at=p.created_at,
            toc=p.toc,
        ),
```

to:

```python
        project=schemas.ProjectOut(
            id=str(p.id),
            title=p.title,
            topic=p.topic,
            audience=p.audience,
            goal=p.goal,
            status=p.status,
            created_at=p.created_at,
            toc=p.toc,
            rights_attested_at=p.rights_attested_at,
            rights_holder=p.rights_holder,
        ),
```

Edit `backend/src/trust/router.py:729-738` (`save_project_toc`) — change:

```python
    return schemas.ProjectOut(
        id=str(p.id),
        title=p.title,
        topic=p.topic,
        audience=p.audience,
        goal=p.goal,
        status=p.status,
        created_at=p.created_at,
        toc=p.toc,
    )
```

to:

```python
    return schemas.ProjectOut(
        id=str(p.id),
        title=p.title,
        topic=p.topic,
        audience=p.audience,
        goal=p.goal,
        status=p.status,
        created_at=p.created_at,
        toc=p.toc,
        rights_attested_at=p.rights_attested_at,
        rights_holder=p.rights_holder,
    )
```

- [ ] **Step 9: Add the `PUT /projects/{project_id}/rights` endpoint**

Append right after `save_project_toc` (`backend/src/trust/router.py:738`, before the blank line at 740):

```python


@router.put("/projects/{project_id}/rights", response_model=schemas.ProjectOut)
async def save_project_rights(
    project_id: uuid.UUID,
    body: schemas.RightsIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectOut:
    """Owner-only rights attestation (B3 Part B) — DISPLAY-ONLY, never gates
    or blocks export. `attested=True` stamps `rights_attested_at=now()`;
    `attested=False` withdraws it (sets it back to null). `rights_holder` is
    stored as given — the mobile client threads it into the exported book's
    `dc:rights` colophon line when set (see artifactToBook.ts/topicsToBook.ts,
    B3 Part B T5); nothing on the backend reads it for any gate."""
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    await project_repo.set_rights(
        conn, project_id=project_id, attested=body.attested, rights_holder=body.rights_holder
    )
    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    return schemas.ProjectOut(
        id=str(p.id),
        title=p.title,
        topic=p.topic,
        audience=p.audience,
        goal=p.goal,
        status=p.status,
        created_at=p.created_at,
        toc=p.toc,
        rights_attested_at=p.rights_attested_at,
        rights_holder=p.rights_holder,
    )
```

- [ ] **Step 10: Run the rights test, confirm it passes**

Run: `cd backend && pytest tests/test_trust_rights_endpoint.py -v`
Expected: 4 passed.

- [ ] **Step 11: Run the broader trust suite to catch regressions from the `_P`/`_project` change**

Run: `cd backend && pytest tests/test_trust_router.py tests/test_trust_project_repo.py -v`
Expected: all passed.

- [ ] **Step 12: Format and commit**

Run: `cd backend && ruff format src/trust/models.py src/trust/project_repo.py src/trust/schemas.py src/trust/router.py tests/test_trust_rights_endpoint.py`

```bash
git add backend/alembic/versions/0023_project_rights.py backend/src/trust/models.py backend/src/trust/project_repo.py backend/src/trust/schemas.py backend/src/trust/router.py backend/tests/test_trust_rights_endpoint.py
git commit -m "feat(trust): owner-only rights attestation on the project row, display-only (B3 Part B T3)"
```

---

### Task 4: Mobile originality (QualityCard + trustClient + screen wiring)

**Files:**
- Modify: `mobile/src/api/trustClient.ts:22-23` (types), `:184-198` (client fns)
- Modify: `mobile/src/components/QualityCard.tsx` (4th row)
- Modify: `mobile/app/trust/version/[versionId].tsx:6,65,135-155,424`
- Modify: `mobile/app/trust/topic-version/[id].tsx:6,56,302-322,352`
- Modify: `mobile/src/help-content/features.ts:28`, `mobile/src/help-content/topics.ts:712`, `mobile/src/help-content/tree.ts:55`
- Test: `mobile/__tests__/screens/QualityCard.test.tsx`
- Test: `mobile/__tests__/screens/TrustVersion.quality.test.tsx`
- Test: `mobile/__tests__/screens/TopicVersionViewer.quality.test.tsx`

**Interfaces:**
- Consumes: `VersionGenerateJobOut` (existing, `trustClient.ts`), `pollJob` (existing, `@/api/pollJob`), `loadApiKey` (existing, `@/secure/keyStore`), Task 2's `POST .../originality-check` endpoints and `quality.originality` on `GET .../versions/{id}`.
- Produces: `OriginalityReport { sections: { index: number; heading: string; overlap: "none"|"paraphrase"|"verbatim"; note: string | null; source_ref: string | null }[]; summary: { verbatim: number; paraphrase: number; clean: number; total: number }; model: string; checked_at: string; stale: boolean }`; `QualityReport.originality: OriginalityReport | null` (new field on the existing type). `runOriginalityCheck(versionId, body, token) -> Promise<VersionGenerateJobOut>`, `runTopicOriginalityCheck(versionId, body, token) -> Promise<VersionGenerateJobOut>`. `QualityCard` props gain optional `origBusy?: boolean` (default `false`) and `onRunOriginality?: () => void` (default no-op) — backward compatible with all 12 existing `QualityCard.test.tsx` call sites, which pass neither.

- [ ] **Step 1: Write the failing `QualityCard` tests**

Edit `mobile/__tests__/screens/QualityCard.test.tsx` — the fixture at the top currently is:

```tsx
const baseQuality: QualityReport = {
  coverage: { sections_total: 10, sections_cited: 8, uncited_section_indexes: [2, 5], dangling: [], source_refs: 9 },
  readability: { flesch_reading_ease: 45.3, grade_level: 11.2, words: 500, sentences: 30 },
  grounding: null,
};
```

Change to:

```tsx
const baseQuality: QualityReport = {
  coverage: { sections_total: 10, sections_cited: 8, uncited_section_indexes: [2, 5], dangling: [], source_refs: 9 },
  readability: { flesch_reading_ease: 45.3, grade_level: 11.2, words: 500, sentences: 30 },
  grounding: null,
  originality: null,
};
```

Append these `it()` blocks at the end of the `describe("QualityCard", ...)` block, right before its closing `});`:

```tsx
  it("owner sees the Run originality check button when originality is null", () => {
    render(<QualityCard quality={baseQuality} isOwner busy={false} onRunGrounding={jest.fn()} onRunOriginality={jest.fn()} />);
    expect(screen.getByLabelText("Run originality check")).toBeTruthy();
  });

  it("non-owner does not see the Run originality check button", () => {
    render(<QualityCard quality={baseQuality} isOwner={false} busy={false} onRunGrounding={jest.fn()} />);
    expect(screen.queryByLabelText("Run originality check")).toBeNull();
  });

  it("renders the originality summary and hides the run button once fresh", () => {
    const withOriginality: QualityReport = {
      ...baseQuality,
      originality: {
        sections: [{ index: 0, heading: "H", overlap: "none", note: null, source_ref: null }],
        summary: { verbatim: 1, paraphrase: 2, clean: 7, total: 10 },
        model: "claude-sonnet-4-6", checked_at: "2026-08-16T12:00:00Z", stale: false,
      },
    };
    render(<QualityCard quality={withOriginality} isOwner busy={false} onRunGrounding={jest.fn()} onRunOriginality={jest.fn()} />);
    expect(screen.getByText("7/10 sections original")).toBeTruthy();
    expect(screen.getByText("1 verbatim, 2 close paraphrase")).toBeTruthy();
    expect(screen.queryByLabelText("Run originality check")).toBeNull();
  });

  it("shows a stale re-run note and the run button again when originality is stale", () => {
    const stale: QualityReport = {
      ...baseQuality,
      originality: {
        sections: [], summary: { verbatim: 0, paraphrase: 0, clean: 0, total: 0 },
        model: "m", checked_at: "2026-08-16T12:00:00Z", stale: true,
      },
    };
    render(<QualityCard quality={stale} isOwner busy={false} onRunGrounding={jest.fn()} onRunOriginality={jest.fn()} />);
    expect(screen.getByText(/inputs changed — re-run/i)).toBeTruthy();
    expect(screen.getByLabelText("Run originality check")).toBeTruthy();
  });

  it("labels the originality section as checking cited sources, not the web", () => {
    render(<QualityCard quality={baseQuality} isOwner busy={false} onRunGrounding={jest.fn()} onRunOriginality={jest.fn()} />);
    expect(screen.getByText(/not the web/i)).toBeTruthy();
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd mobile && npx jest __tests__/screens/QualityCard.test.tsx`
Expected: `TypeError: Cannot read properties of undefined (reading 'clean')` (or a TS compile error on the missing `originality` field) and the new `it()`s fail with "Unable to find an element with accessibilityLabel: Run originality check".

- [ ] **Step 3: Add the 4th row to `QualityCard.tsx`**

Edit `mobile/src/components/QualityCard.tsx:8-13` (the `Props` interface) — change:

```tsx
interface Props {
  quality: QualityReport | null | undefined;
  isOwner: boolean;
  busy: boolean;
  onRunGrounding: () => void;
}
```

to:

```tsx
interface Props {
  quality: QualityReport | null | undefined;
  isOwner: boolean;
  busy: boolean;
  onRunGrounding: () => void;
  origBusy?: boolean;
  onRunOriginality?: () => void;
}
```

Edit `mobile/src/components/QualityCard.tsx:23-27` — change:

```tsx
export function QualityCard({ quality, isOwner, busy, onRunGrounding }: Props): React.JSX.Element | null {
  const styles = useThemedStyles(makeStyles);
  if (!quality) return null;

  const { coverage, readability, grounding } = quality;
```

to:

```tsx
export function QualityCard({ quality, isOwner, busy, onRunGrounding, origBusy = false, onRunOriginality = () => {} }: Props): React.JSX.Element | null {
  const styles = useThemedStyles(makeStyles);
  if (!quality) return null;

  const { coverage, readability, grounding, originality } = quality;
```

Insert a 4th row right after the Grounding `</View>` and before the closing `</Card>` (`mobile/src/components/QualityCard.tsx:87-89`) — change:

```tsx
        ) : (
          <Text style={styles.subNote}>Not yet checked.</Text>
        )}
      </View>
    </Card>
  );
}
```

to:

```tsx
        ) : (
          <Text style={styles.subNote}>Not yet checked.</Text>
        )}
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Originality</Text>
        {originality ? (
          <>
            <Text style={styles.value}>{`${originality.summary.clean}/${originality.summary.total} sections original`}</Text>
            {originality.summary.verbatim || originality.summary.paraphrase ? (
              <Text style={styles.subNote}>
                {`${originality.summary.verbatim} verbatim, ${originality.summary.paraphrase} close paraphrase`}
              </Text>
            ) : null}
            <Text style={styles.subNote}>{`checked ${new Date(originality.checked_at).toLocaleString()}`}</Text>
            <Text style={styles.subNote}>Checks your draft against your cited sources only — not the web.</Text>
            {originality.stale ? (
              <>
                <Text style={styles.staleNote}>inputs changed — re-run</Text>
                {isOwner ? (
                  <Button
                    variant="ghost"
                    label="Run originality check"
                    accessibilityLabel="Run originality check"
                    busy={origBusy}
                    onPress={onRunOriginality}
                  />
                ) : null}
              </>
            ) : null}
          </>
        ) : isOwner ? (
          <>
            <Text style={styles.subNote}>Checks your draft against your cited sources only — not the web.</Text>
            <Button
              variant="ghost"
              label="Run originality check"
              accessibilityLabel="Run originality check"
              busy={origBusy}
              onPress={onRunOriginality}
            />
          </>
        ) : (
          <Text style={styles.subNote}>Not yet checked.</Text>
        )}
      </View>
    </Card>
  );
}
```

- [ ] **Step 4: Run the `QualityCard` tests, confirm they pass**

Run: `cd mobile && npx jest __tests__/screens/QualityCard.test.tsx`
Expected: all passed (17 total: 12 pre-existing + 5 new).

- [ ] **Step 5: Add the client types + functions to `trustClient.ts`**

Edit `mobile/src/api/trustClient.ts:22-23` — change:

```ts
export interface GroundingReport { claims_total: number; supported: number; partial: number; unsupported: number; by_section: { section_index: number; claims: { text: string; status: "supported" | "partial" | "unsupported"; source_ids: string[] }[] }[]; model: string; checked_at: string; stale: boolean }
export interface QualityReport { coverage: CoverageReport; readability: Readability; grounding: GroundingReport | null }
```

to:

```ts
export interface GroundingReport { claims_total: number; supported: number; partial: number; unsupported: number; by_section: { section_index: number; claims: { text: string; status: "supported" | "partial" | "unsupported"; source_ids: string[] }[] }[]; model: string; checked_at: string; stale: boolean }
export interface OriginalityReport { sections: { index: number; heading: string; overlap: "none" | "paraphrase" | "verbatim"; note: string | null; source_ref: string | null }[]; summary: { verbatim: number; paraphrase: number; clean: number; total: number }; model: string; checked_at: string; stale: boolean }
export interface QualityReport { coverage: CoverageReport; readability: Readability; grounding: GroundingReport | null; originality: OriginalityReport | null }
```

Edit `mobile/src/api/trustClient.ts:184-198` (right after `runTopicGroundingCheck`) — change:

```ts
export async function runTopicGroundingCheck(
  versionId: string, body: { api_key?: string; provider_id?: string; model?: string }, token: string,
): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(
    `/topic-versions/${versionId}/grounding-check`, token, { method: "POST", body: JSON.stringify(body) },
  )) as VersionGenerateJobOut;
}
```

to:

```ts
export async function runTopicGroundingCheck(
  versionId: string, body: { api_key?: string; provider_id?: string; model?: string }, token: string,
): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(
    `/topic-versions/${versionId}/grounding-check`, token, { method: "POST", body: JSON.stringify(body) },
  )) as VersionGenerateJobOut;
}

// On-demand originality/source-overlap check (B3 T4): POST
// .../originality-check returns 202 + this job handle immediately (same
// shape as runGroundingCheck); the actual LLM pass runs in a Celery worker.
// Poll via the shared GET /api/v1/jobs/{id} endpoint (@/api/pollJob), then
// refetch the version so `quality.originality` reflects the fresh result.
// Checks the draft against ITS OWN cited sources only — never the web.
export async function runOriginalityCheck(
  versionId: string, body: { api_key?: string; provider_id?: string; model?: string }, token: string,
): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(
    `/artifacts/versions/${versionId}/originality-check`, token, { method: "POST", body: JSON.stringify(body) },
  )) as VersionGenerateJobOut;
}

export async function runTopicOriginalityCheck(
  versionId: string, body: { api_key?: string; provider_id?: string; model?: string }, token: string,
): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(
    `/topic-versions/${versionId}/originality-check`, token, { method: "POST", body: JSON.stringify(body) },
  )) as VersionGenerateJobOut;
}
```

- [ ] **Step 6: Write the failing screen-wiring tests**

Edit `mobile/__tests__/screens/TrustVersion.quality.test.tsx` — change the `mockRunGroundingCheck` mock block:

```tsx
const mockRunGroundingCheck = jest.fn();
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
    feedback: [],
    quality: {
      coverage: { sections_total: 10, sections_cited: 8, uncited_section_indexes: [], dangling: [], source_refs: 8 },
      readability: { flesch_reading_ease: 45.3, grade_level: 11.2, words: 500, sentences: 30 },
      grounding: null,
    },
  })),
  addFeedback: jest.fn(),
  runGroundingCheck: (...args: unknown[]) => mockRunGroundingCheck(...args),
}));
```

to:

```tsx
const mockRunGroundingCheck = jest.fn();
const mockRunOriginalityCheck = jest.fn();
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
    feedback: [],
    quality: {
      coverage: { sections_total: 10, sections_cited: 8, uncited_section_indexes: [], dangling: [], source_refs: 8 },
      readability: { flesch_reading_ease: 45.3, grade_level: 11.2, words: 500, sentences: 30 },
      grounding: null,
      originality: null,
    },
  })),
  addFeedback: jest.fn(),
  runGroundingCheck: (...args: unknown[]) => mockRunGroundingCheck(...args),
  runOriginalityCheck: (...args: unknown[]) => mockRunOriginalityCheck(...args),
}));
```

and in `beforeEach`, change:

```tsx
beforeEach(() => {
  mockRole = "owner";
  jest.clearAllMocks();
  mockRunGroundingCheck.mockResolvedValue({ job_id: "job-1", status: "queued" });
});
```

to:

```tsx
beforeEach(() => {
  mockRole = "owner";
  jest.clearAllMocks();
  mockRunGroundingCheck.mockResolvedValue({ job_id: "job-1", status: "queued" });
  mockRunOriginalityCheck.mockResolvedValue({ job_id: "job-3", status: "queued" });
});
```

Append at the end of the file:

```tsx

it("owner sees Run originality check, and pressing it calls runOriginalityCheck with THIS version's id", async () => {
  mockRole = "owner";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByLabelText("Run originality check")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Run originality check"));

  await waitFor(() => expect(mockRunOriginalityCheck).toHaveBeenCalledWith(
    "v1", { api_key: "sk-ant-x", provider_id: "anthropic" }, "tok",
  ));
  await waitFor(() => expect(pollJob).toHaveBeenCalledWith(
    "job-3", "tok", expect.objectContaining({ intervalMs: expect.any(Number) }),
  ));
});

it("reviewer does not see Run originality check", async () => {
  mockRole = "reviewer";
  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("8/10 sections cite a source")).toBeTruthy());
  expect(screen.queryByLabelText("Run originality check")).toBeNull();
});
```

Apply the same pair of edits to `mobile/__tests__/screens/TopicVersionViewer.quality.test.tsx` (mock `runTopicOriginalityCheck` instead, `id: "tv1"` instead of `versionId: "v1"`, `TopicVersionViewer` instead of `TrustVersion`):

Change the mock block:

```tsx
const mockRunTopicGroundingCheck = jest.fn();
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: false, recorded_via: null,
    generation_meta: null, feedback: [],
    quality: {
      coverage: { sections_total: 5, sections_cited: 4, uncited_section_indexes: [0], dangling: [], source_refs: 4 },
      readability: { flesch_reading_ease: 52.1, grade_level: 9.4, words: 300, sentences: 20 },
      grounding: null,
    },
  })),
  runTopicGroundingCheck: (...args: unknown[]) => mockRunTopicGroundingCheck(...args),
}));
```

to:

```tsx
const mockRunTopicGroundingCheck = jest.fn();
const mockRunTopicOriginalityCheck = jest.fn();
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: false, recorded_via: null,
    generation_meta: null, feedback: [],
    quality: {
      coverage: { sections_total: 5, sections_cited: 4, uncited_section_indexes: [0], dangling: [], source_refs: 4 },
      readability: { flesch_reading_ease: 52.1, grade_level: 9.4, words: 300, sentences: 20 },
      grounding: null,
      originality: null,
    },
  })),
  runTopicGroundingCheck: (...args: unknown[]) => mockRunTopicGroundingCheck(...args),
  runTopicOriginalityCheck: (...args: unknown[]) => mockRunTopicOriginalityCheck(...args),
}));
```

Change `beforeEach`:

```tsx
beforeEach(() => {
  mockRole = "owner";
  jest.clearAllMocks();
  mockRunTopicGroundingCheck.mockResolvedValue({ job_id: "job-2", status: "queued" });
});
```

to:

```tsx
beforeEach(() => {
  mockRole = "owner";
  jest.clearAllMocks();
  mockRunTopicGroundingCheck.mockResolvedValue({ job_id: "job-2", status: "queued" });
  mockRunTopicOriginalityCheck.mockResolvedValue({ job_id: "job-4", status: "queued" });
});
```

Append at the end of the file:

```tsx

it("owner sees Run originality check, and pressing it calls runTopicOriginalityCheck with THIS version's id", async () => {
  mockRole = "owner";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByLabelText("Run originality check")).toBeTruthy());

  fireEvent.press(screen.getByLabelText("Run originality check"));

  await waitFor(() => expect(mockRunTopicOriginalityCheck).toHaveBeenCalledWith(
    "tv1", { api_key: "sk-ant-x", provider_id: "anthropic" }, "tok",
  ));
  await waitFor(() => expect(pollJob).toHaveBeenCalledWith(
    "job-4", "tok", expect.objectContaining({ intervalMs: expect.any(Number) }),
  ));
});

it("reviewer does not see Run originality check", async () => {
  mockRole = "reviewer";
  render(<TopicVersionViewer />);
  await waitFor(() => expect(screen.getByText("4/5 sections cite a source")).toBeTruthy());
  expect(screen.queryByLabelText("Run originality check")).toBeNull();
});
```

- [ ] **Step 7: Run the screen tests, confirm they fail**

Run: `cd mobile && npx jest __tests__/screens/TrustVersion.quality.test.tsx __tests__/screens/TopicVersionViewer.quality.test.tsx`
Expected: the 4 new tests fail with "Unable to find an element with accessibilityLabel: Run originality check" (the screens don't wire `onRunOriginality`/`origBusy` yet).

- [ ] **Step 8: Wire `mobile/app/trust/version/[versionId].tsx`**

Edit line 6 — change:

```tsx
import { addFeedback, getVersion, runGroundingCheck, type VersionDetailView } from "@/api/trustClient";
```

to:

```tsx
import { addFeedback, getVersion, runGroundingCheck, runOriginalityCheck, type VersionDetailView } from "@/api/trustClient";
```

Edit line 65 — change:

```tsx
  const [grBusy, setGrBusy] = useState(false);
```

to:

```tsx
  const [grBusy, setGrBusy] = useState(false);
  const [orBusy, setOrBusy] = useState(false);
```

Insert a new handler right after `onRunGrounding` closes (`mobile/app/trust/version/[versionId].tsx:135-155`, immediately after the closing `};` on line 155, before the "Sibling versions" comment on line 157):

```tsx
  // Owner-only: submits the on-demand originality/source-overlap check
  // (billable LLM pass) — checks the draft against ITS OWN cited sources
  // only, never the web. Byte-for-byte mirror of onRunGrounding above.
  const onRunOriginality = () => {
    if (!accessToken) return;
    setOrBusy(true);
    void (async () => {
      try {
        const key = await loadApiKey("anthropic");
        if (!key && knownNotPro) throw new Error("No API key saved. Add an Anthropic key in Settings to run an originality check.");
        const submitted = await runOriginalityCheck(String(versionId), { api_key: key ?? undefined, provider_id: "anthropic" }, accessToken);
        await pollJob(submitted.job_id, accessToken, {
          intervalMs: 3_000,
          timeoutMessage: "Timed out waiting for the originality check",
          failedMessage: "Originality check failed",
        });
        await reloadVersion().catch(() => {});
      } catch (e) {
        Alert.alert("Couldn't run originality check", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Please try again.");
      } finally {
        setOrBusy(false);
      }
    })();
  };
```

Edit line 424 — change:

```tsx
        <QualityCard quality={version.quality} isOwner={isOwner} busy={grBusy} onRunGrounding={onRunGrounding} />
```

to:

```tsx
        <QualityCard quality={version.quality} isOwner={isOwner} busy={grBusy} onRunGrounding={onRunGrounding} origBusy={orBusy} onRunOriginality={onRunOriginality} />
```

- [ ] **Step 9: Wire `mobile/app/trust/topic-version/[id].tsx`**

Edit line 6 — change:

```tsx
import { getTopicVersion, runTopicGroundingCheck, type TopicVersionDetailView, type TopicVersionSummaryView } from "@/api/trustClient";
```

to:

```tsx
import { getTopicVersion, runTopicGroundingCheck, runTopicOriginalityCheck, type TopicVersionDetailView, type TopicVersionSummaryView } from "@/api/trustClient";
```

Edit line 56 — change:

```tsx
  const [grBusy, setGrBusy] = useState(false);
```

to:

```tsx
  const [grBusy, setGrBusy] = useState(false);
  const [orBusy, setOrBusy] = useState(false);
```

Insert a new handler right after `onRunGrounding` closes (`mobile/app/trust/topic-version/[id].tsx:302-322`, immediately after the closing `};` on line 322, before the `if (error) return ...` line 324):

```tsx
  // Owner-only: submits the on-demand originality/source-overlap check.
  // Mirrors trust/version/[versionId].tsx's onRunOriginality (the topic twin
  // of onRunGrounding just above).
  const onRunOriginality = () => {
    if (!accessToken) return;
    setOrBusy(true);
    void (async () => {
      try {
        const key = await loadApiKey("anthropic");
        if (!key && knownNotPro) throw new Error("No API key saved. Add an Anthropic key in Settings to run an originality check.");
        const submitted = await runTopicOriginalityCheck(String(id), { api_key: key ?? undefined, provider_id: "anthropic" }, accessToken);
        await pollJob(submitted.job_id, accessToken, {
          intervalMs: 3_000,
          timeoutMessage: "Timed out waiting for the originality check",
          failedMessage: "Originality check failed",
        });
        await reload().catch(() => {});
      } catch (e) {
        Alert.alert("Couldn't run originality check", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Please try again.");
      } finally {
        setOrBusy(false);
      }
    })();
  };
```

Edit line 352 — change:

```tsx
          <QualityCard quality={topicVersion.quality} isOwner={isOwner} busy={grBusy} onRunGrounding={onRunGrounding} />
```

to:

```tsx
          <QualityCard quality={topicVersion.quality} isOwner={isOwner} busy={grBusy} onRunGrounding={onRunGrounding} origBusy={orBusy} onRunOriginality={onRunOriginality} />
```

- [ ] **Step 10: Run all the mobile tests from this task, confirm they pass**

Run: `cd mobile && npx jest __tests__/screens/QualityCard.test.tsx __tests__/screens/TrustVersion.quality.test.tsx __tests__/screens/TopicVersionViewer.quality.test.tsx`
Expected: all passed.

- [ ] **Step 11: Add the Help feature, topic, and tree leaf**

Edit `mobile/src/help-content/features.ts:28` — change:

```ts
  { key: "grounding-report", label: "Quality report (coverage, readability & grounding)" },
```

to:

```ts
  { key: "grounding-report", label: "Quality report (coverage, readability & grounding)" },
  { key: "originality-report", label: "Originality check (source overlap)" },
```

Edit `mobile/src/help-content/topics.ts` — insert a new topic object right after the `grounding-report` topic's closing `},` (currently `mobile/src/help-content/topics.ts:712`, immediately before the `generate-full-book` topic at line 713):

```ts
  {
    id: "originality-report",
    title: "Originality check: source overlap",
    featureKey: "originality-report",
    keywords: ["originality", "plagiarism", "copyright", "verbatim", "paraphrase", "source overlap", "rights"],
    blocks: [
      {
        kind: "text",
        text: "The originality check audits a draft against ONLY the sources you cited in it — it does not search the web. An owner taps \"Run originality check\" to have the AI model re-read each cited section and flag whether it reproduces the source verbatim, stays close as a paraphrase, or is written in the author's own words (synthesized).",
      },
      {
        kind: "text",
        text: "A section with no cited source has nothing to compare against, so it's automatically counted as original with no LLM call. Like the grounding check, this is a separate, billable pass over your model — it only runs when you ask for it, and a re-run replaces the previous result.",
      },
      {
        kind: "text",
        text: "If the draft or its sources change after a check, the stored result is marked stale, with a note to re-run it.",
      },
      {
        kind: "text",
        text: "This is NOT a plagiarism scan against the internet, and it is not a copyright check — see \"Rights & attribution\" for that. It only tells you how closely your own writing tracks the sources you chose to cite.",
      },
    ],
  },
```

Edit `mobile/src/help-content/tree.ts:49-57` (the `projects-feedback` node) — change:

```ts
      {
        id: "projects-feedback",
        title: "Feedback",
        children: [
          { id: "leaf-reviews-tab", title: "The Reviews tab", topicId: "reviews" },
          { id: "leaf-draft-viewer", title: "Read, approve & revise a draft", topicId: "draft-viewer" },
          { id: "leaf-grounding-report", title: "Quality report", topicId: "grounding-report" },
        ],
      },
```

to:

```ts
      {
        id: "projects-feedback",
        title: "Feedback",
        children: [
          { id: "leaf-reviews-tab", title: "The Reviews tab", topicId: "reviews" },
          { id: "leaf-draft-viewer", title: "Read, approve & revise a draft", topicId: "draft-viewer" },
          { id: "leaf-grounding-report", title: "Quality report", topicId: "grounding-report" },
          { id: "leaf-originality-report", title: "Originality check", topicId: "originality-report" },
        ],
      },
```

- [ ] **Step 12: Run the Help gates**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts __tests__/help/tree.test.ts`
Expected: all passed.

- [ ] **Step 13: Run the full mobile suite for regressions**

Run: `cd mobile && npx jest __tests__/screens __tests__/help`
Expected: all passed.

- [ ] **Step 14: Commit**

```bash
git add mobile/src/api/trustClient.ts mobile/src/components/QualityCard.tsx mobile/app/trust/version/\[versionId\].tsx mobile/app/trust/topic-version/\[id\].tsx mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/src/help-content/tree.ts mobile/__tests__/screens/QualityCard.test.tsx mobile/__tests__/screens/TrustVersion.quality.test.tsx mobile/__tests__/screens/TopicVersionViewer.quality.test.tsx
git commit -m "feat(mobile): originality check card, client, screen wiring + Help (B3 Part A T4)"
```

---

### Task 5: Mobile rights attestation (Publish surface + colophon thread)

**Files:**
- Modify: `mobile/src/api/trustClient.ts:10-14` (`ProjectView`), append `saveRights` after `saveToc` (line 242)
- Modify: `mobile/src/hooks/useTrustProject.ts:4` (import), append `saveRights` after `saveToc` (line 127), extend the `return` (line 204)
- Modify: `mobile/src/lib/artifactToBook.ts` (add optional `metadata` param)
- Modify: `mobile/src/lib/topicsToBook.ts` (add optional `metadata` param)
- Modify: `mobile/app/trust/[projectId].tsx` (rights state/handlers, `rightsMetadata` helper, thread into the 4 export call sites, `PublishPanel` UI)
- Modify: `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`, `mobile/src/help-content/tree.ts`
- Test: `mobile/__tests__/lib/artifactToBook.test.ts`
- Test: `mobile/__tests__/lib/topicsToBook.test.ts`
- Test: `mobile/__tests__/hooks/useTrustProject.test.tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.rights.test.tsx` (new file)

**Interfaces:**
- Consumes: Task 3's `PUT /projects/{id}/rights` and `ProjectOut.{rights_attested_at, rights_holder}`; `BookMetadata` (existing, `mobile/src/types/book.ts:116-139`, already has `rights?: string`).
- Produces: `ProjectView.{rights_attested_at: string | null; rights_holder: string | null}` (new required fields on the existing type). `saveRights(projectId: string, body: { attested: boolean; rights_holder?: string }, token: string) -> Promise<ProjectView>` (trustClient). `useTrustProject(...).saveRights(attested: boolean, rightsHolder?: string) -> Promise<void>` (hook, refreshes `project` on success). `artifactToBook(sections, title, inputs, metadata?: BookMetadata) -> Book` and `topicsToBook(projectTitle, toc, topicSections, inputs, metadata?: BookMetadata) -> Book` — 4th/5th optional param, `Book.metadata` (existing field) set from it.

- [ ] **Step 1: Write the failing `artifactToBook`/`topicsToBook` tests**

Append to `mobile/__tests__/lib/artifactToBook.test.ts`:

```ts

it("threads an optional metadata param onto the returned Book unchanged", () => {
  const book = artifactToBook(
    [{ heading: "H", body: "B", source_ids: [] }], "Title", [],
    { rights: "© 2026 Jane Doe. All rights reserved." },
  );
  expect(book.metadata).toEqual({ rights: "© 2026 Jane Doe. All rights reserved." });
});

it("leaves metadata undefined when none is passed (default export behavior unchanged)", () => {
  const book = artifactToBook([{ heading: "H", body: "B", source_ids: [] }], "Title", []);
  expect(book.metadata).toBeUndefined();
});
```

Append to `mobile/__tests__/lib/topicsToBook.test.ts`:

```ts

it("threads an optional metadata param onto the returned Book unchanged", () => {
  const book = topicsToBook("My Project", toc, sections(), inputs, { rights: "© 2026 Jane Doe. All rights reserved." });
  expect(book.metadata).toEqual({ rights: "© 2026 Jane Doe. All rights reserved." });
});

it("leaves metadata undefined when none is passed (default export behavior unchanged)", () => {
  const book = topicsToBook("My Project", toc, sections(), inputs);
  expect(book.metadata).toBeUndefined();
});
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `cd mobile && npx jest __tests__/lib/artifactToBook.test.ts __tests__/lib/topicsToBook.test.ts`
Expected: both new tests fail — `book.metadata` is `undefined` even when a 4th arg is passed (the functions don't accept it yet); the TS compiler also flags the extra argument.

- [ ] **Step 3: Add the `metadata` param to `artifactToBook.ts`**

Edit `mobile/src/lib/artifactToBook.ts:1-10` — change:

```ts
import { randomUUID } from "@/lib/uuid";
import type { DraftSection, ProjectInputView } from "@/api/trustClient";
import type { Book } from "@/types/book";
import type { LessonSection } from "@/types/lesson";

export function artifactToBook(
  sections: DraftSection[],
  title: string,
  inputs: ProjectInputView[],
): Book {
```

to:

```ts
import { randomUUID } from "@/lib/uuid";
import type { DraftSection, ProjectInputView } from "@/api/trustClient";
import type { Book, BookMetadata } from "@/types/book";
import type { LessonSection } from "@/types/lesson";

export function artifactToBook(
  sections: DraftSection[],
  title: string,
  inputs: ProjectInputView[],
  metadata?: BookMetadata,
): Book {
```

Edit `mobile/src/lib/artifactToBook.ts:44-55` (the `return`) — change:

```ts
  return {
    id: randomUUID(),
    title: safeTitle,
    toc: {
      subjects: [
        { subject_label: safeTitle, units: [{ id: topicId, title: safeTitle, subtopics: [], prerequisites: [] }] },
      ],
    },
    content: { [topicId]: { topicId, title: safeTitle, lesson, generatedAt: now } },
    createdAt: now,
    updatedAt: now,
  };
}
```

to:

```ts
  return {
    id: randomUUID(),
    title: safeTitle,
    toc: {
      subjects: [
        { subject_label: safeTitle, units: [{ id: topicId, title: safeTitle, subtopics: [], prerequisites: [] }] },
      ],
    },
    content: { [topicId]: { topicId, title: safeTitle, lesson, generatedAt: now } },
    createdAt: now,
    updatedAt: now,
    metadata,
  };
}
```

- [ ] **Step 4: Add the `metadata` param to `topicsToBook.ts`**

Edit `mobile/src/lib/topicsToBook.ts:1-33` — change:

```ts
import { randomUUID } from "@/lib/uuid";
import type { DraftSection, ProjectInputView, StructuredTocView } from "@/api/trustClient";
import type { Book, SubjectNode, TopicNode, GeneratedTopic } from "@/types/book";
import type { LessonOutput, LessonSection } from "@/types/lesson";
```

to:

```ts
import { randomUUID } from "@/lib/uuid";
import type { DraftSection, ProjectInputView, StructuredTocView } from "@/api/trustClient";
import type { Book, BookMetadata, SubjectNode, TopicNode, GeneratedTopic } from "@/types/book";
import type { LessonOutput, LessonSection } from "@/types/lesson";
```

and change:

```ts
export function topicsToBook(
  projectTitle: string,
  toc: StructuredTocView,
  topicSections: Map<string, DraftSection[]>,
  inputs: ProjectInputView[],
): Book {
```

to:

```ts
export function topicsToBook(
  projectTitle: string,
  toc: StructuredTocView,
  topicSections: Map<string, DraftSection[]>,
  inputs: ProjectInputView[],
  metadata?: BookMetadata,
): Book {
```

Edit `mobile/src/lib/topicsToBook.ts:79-86` (the `return`) — change:

```ts
  return {
    id: randomUUID(),
    title: safeTitle,
    toc: { subjects },
    content,
    createdAt: now,
    updatedAt: now,
  };
}
```

to:

```ts
  return {
    id: randomUUID(),
    title: safeTitle,
    toc: { subjects },
    content,
    createdAt: now,
    updatedAt: now,
    metadata,
  };
}
```

- [ ] **Step 5: Run the lib tests, confirm they pass**

Run: `cd mobile && npx jest __tests__/lib/artifactToBook.test.ts __tests__/lib/topicsToBook.test.ts`
Expected: all passed (existing tests unaffected — `metadata` is optional and defaults to `undefined`).

- [ ] **Step 6: Add `rights_attested_at`/`rights_holder` + `saveRights` to `trustClient.ts`**

Edit `mobile/src/api/trustClient.ts:10-14` — change:

```ts
export interface ProjectView {
  id: string; title: string; topic: string | null; audience: string | null;
  goal: string | null; status: string; created_at: string | null;
  toc?: StructuredTocView;
}
```

to:

```ts
export interface ProjectView {
  id: string; title: string; topic: string | null; audience: string | null;
  goal: string | null; status: string; created_at: string | null;
  toc?: StructuredTocView;
  rights_attested_at: string | null;
  rights_holder: string | null;
}
```

Insert right after `saveToc` (`mobile/src/api/trustClient.ts:240-242`) — change:

```ts
export async function saveToc(projectId: string, toc: StructuredTocView, token: string): Promise<void> {
  await trustFetch(`/projects/${projectId}/toc`, token, { method: "PUT", body: JSON.stringify({ toc }) });
}
```

to:

```ts
export async function saveToc(projectId: string, toc: StructuredTocView, token: string): Promise<void> {
  await trustFetch(`/projects/${projectId}/toc`, token, { method: "PUT", body: JSON.stringify({ toc }) });
}

// Owner-only rights attestation (B3 Part B, display-only — never gates
// export). attested=false withdraws a prior attestation.
export async function saveRights(
  projectId: string, body: { attested: boolean; rights_holder?: string }, token: string,
): Promise<ProjectView> {
  return (await trustFetch<ProjectView>(
    `/projects/${projectId}/rights`, token, { method: "PUT", body: JSON.stringify(body) },
  )) as ProjectView;
}
```

- [ ] **Step 7: Write the failing hook test**

`mobile/__tests__/hooks/useTrustProject.test.tsx` mocks `@/api/trustClient` at line 6 as `jest.mock("@/api/trustClient", () => ({ getProject: jest.fn(), approveVersion: jest.fn(), createArtifact: jest.fn() }))`, and every other test in the file accesses the mocked functions via `import * as tc from "@/api/trustClient";` then `tc.getProject`/`tc.approveVersion` (see line 13, 43-44). `saveRights` must be added to that SAME mock object — a second `jest.mock("@/api/trustClient", ...)` call would just overwrite the first, not merge with it.

Edit `mobile/__tests__/hooks/useTrustProject.test.tsx:6` — change:

```tsx
jest.mock("@/api/trustClient", () => ({ getProject: jest.fn(), approveVersion: jest.fn(), createArtifact: jest.fn() }));
```

to:

```tsx
jest.mock("@/api/trustClient", () => ({ getProject: jest.fn(), approveVersion: jest.fn(), createArtifact: jest.fn(), saveRights: jest.fn() }));
```

Append at the end of the file:

```tsx

it("saveRights calls the trustClient PUT and refreshes the project", async () => {
  (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "owner", artifacts: [] });
  (tc.saveRights as jest.Mock).mockResolvedValue({ id: "p1", title: "P", rights_attested_at: "2026-08-18T00:00:00Z", rights_holder: "Jane Doe" });

  const { result } = renderHook(() => useTrustProject("p1"));
  await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

  await act(async () => {
    await result.current.saveRights(true, "Jane Doe");
  });

  expect(tc.saveRights).toHaveBeenCalledWith("p1", { attested: true, rights_holder: "Jane Doe" }, "tok");
  expect((tc.getProject as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2); // refresh() re-fetches
});
```

- [ ] **Step 8: Run it, confirm it fails**

Run: `cd mobile && npx jest __tests__/hooks/useTrustProject.test.tsx`
Expected: `result.current.saveRights is not a function`.

- [ ] **Step 9: Add `saveRights` to the hook**

Edit `mobile/src/hooks/useTrustProject.ts:4` — change:

```ts
import { addProjectInput, addTopicFeedback as addTopicFeedbackApi, approveVersion, createArtifact, createTopicVersion, createVersion, deleteInput, getProject, getTopicVersions, getVersion, invite as inviteApi, recordTopicApproval, saveToc as saveTocApi, updateInput, withdrawApproval, withdrawTopicApproval, type ApprovalView, type ProjectDetailView, type ProjectInputView, type StructuredTocView, type TopicApprovalView, type TopicFeedbackView, type TopicVersionCreatedView, type TopicVersionSummaryView, type VersionDetailView } from "@/api/trustClient";
```

to:

```ts
import { addProjectInput, addTopicFeedback as addTopicFeedbackApi, approveVersion, createArtifact, createTopicVersion, createVersion, deleteInput, getProject, getTopicVersions, getVersion, invite as inviteApi, recordTopicApproval, saveRights as saveRightsApi, saveToc as saveTocApi, updateInput, withdrawApproval, withdrawTopicApproval, type ApprovalView, type ProjectDetailView, type ProjectInputView, type StructuredTocView, type TopicApprovalView, type TopicFeedbackView, type TopicVersionCreatedView, type TopicVersionSummaryView, type VersionDetailView } from "@/api/trustClient";
```

Insert right after `saveToc` (`mobile/src/hooks/useTrustProject.ts:123-127`) — change:

```ts
  const saveToc = useCallback(async (toc: StructuredTocView) => {
    if (!accessToken) throw new Error("Not signed in");
    await saveTocApi(projectId, toc, accessToken);
    await refresh();
  }, [accessToken, projectId, refresh]);
```

to:

```ts
  const saveToc = useCallback(async (toc: StructuredTocView) => {
    if (!accessToken) throw new Error("Not signed in");
    await saveTocApi(projectId, toc, accessToken);
    await refresh();
  }, [accessToken, projectId, refresh]);

  const saveRights = useCallback(async (attested: boolean, rightsHolder?: string) => {
    if (!accessToken) throw new Error("Not signed in");
    await saveRightsApi(projectId, { attested, rights_holder: rightsHolder }, accessToken);
    await refresh();
  }, [accessToken, projectId, refresh]);
```

Edit the `return` (`mobile/src/hooks/useTrustProject.ts:204`) — change:

```ts
  return { project, loading, error, refresh, approve, unapprove, loadVersionContent, addArtifact, addVersion, generateVersion, generateFormat, suggestToc, saveToc, invite, addInput, editInput, removeInput, inputs, generateTopic, approveTopic, withdrawTopic, listTopicVersions, addTopicFeedback, editTopic, accessToken, knownNotPro };
```

to:

```ts
  return { project, loading, error, refresh, approve, unapprove, loadVersionContent, addArtifact, addVersion, generateVersion, generateFormat, suggestToc, saveToc, saveRights, invite, addInput, editInput, removeInput, inputs, generateTopic, approveTopic, withdrawTopic, listTopicVersions, addTopicFeedback, editTopic, accessToken, knownNotPro };
```

- [ ] **Step 10: Run the hook test, confirm it passes**

Run: `cd mobile && npx jest __tests__/hooks/useTrustProject.test.tsx`
Expected: all passed.

- [ ] **Step 11: Write the failing screen test**

Create `mobile/__tests__/screens/TrustProjectDetail.rights.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
import { useTrustProject } from "@/hooks/useTrustProject";
import { Alert } from "@/lib/alert";

const mockSaveRights = jest.fn(async () => {});

const base = (rights: { rights_attested_at: string | null; rights_holder: string | null }, role = "owner") => ({
  project: {
    project: { id: "p1", title: "Medicare", topic: null, ...rights },
    my_role: role,
    inputs: [],
    artifacts: [],
  },
  loading: false, error: null, refresh: jest.fn(), loadVersionContent: jest.fn(), inputs: [],
  saveRights: mockSaveRights,
});

beforeEach(() => jest.clearAllMocks());

it("owner sees the rights attestation control on Publish, unattested by default", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ rights_attested_at: null, rights_holder: null }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  expect(screen.getByLabelText("I attest I hold the rights to my sources")).toBeTruthy();
  expect(screen.getByText("Not attested")).toBeTruthy();
});

it("pressing the attestation checkbox calls saveRights with attested=true", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ rights_attested_at: null, rights_holder: null }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  fireEvent.press(screen.getByLabelText("I attest I hold the rights to my sources"));
  await waitFor(() => expect(mockSaveRights).toHaveBeenCalledWith(true, undefined));
});

it("saving a rights holder name calls saveRights with the current attested state", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ rights_attested_at: "2026-08-18T00:00:00Z", rights_holder: "Jane" }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  const input = screen.getByLabelText("Rights holder");
  fireEvent.changeText(input, "Jane Doe");
  fireEvent.press(screen.getByLabelText("Save rights holder"));
  await waitFor(() => expect(mockSaveRights).toHaveBeenCalledWith(true, "Jane Doe"));
});

it("shows the author-responsibility note to every role, and hides the attestation control from a reviewer", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ rights_attested_at: null, rights_holder: null }, "reviewer"));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  expect(screen.getByText(/Originality & rights are the author's responsibility/)).toBeTruthy();
  expect(screen.queryByLabelText("I attest I hold the rights to my sources")).toBeNull();
});

it("shows a save error via Alert when saveRights rejects", async () => {
  mockSaveRights.mockRejectedValueOnce(new Error("network down"));
  (useTrustProject as jest.Mock).mockReturnValue(base({ rights_attested_at: null, rights_holder: null }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  fireEvent.press(screen.getByLabelText("I attest I hold the rights to my sources"));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Couldn't save", "network down"));
});
```

- [ ] **Step 12: Run it, confirm it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail.rights.test.tsx`
Expected: all 5 fail — `screen.getByLabelText("I attest I hold the rights to my sources")` not found (the control doesn't exist yet).

- [ ] **Step 13: Wire the rights state/handlers + `rightsMetadata` helper into `[projectId].tsx`**

Edit `mobile/app/trust/[projectId].tsx:1394` — change:

```tsx
  const { project, loading, error, refresh, generateFormat, generateTopic, invite, addInput, editInput, removeInput, loadVersionContent, suggestToc, saveToc, inputs: sourceInputs, accessToken } = useTrustProject(String(projectId));
```

to:

```tsx
  const { project, loading, error, refresh, generateFormat, generateTopic, invite, addInput, editInput, removeInput, loadVersionContent, suggestToc, saveToc, saveRights, inputs: sourceInputs, accessToken } = useTrustProject(String(projectId));
```

Add local state and a sync effect right after that line:

```tsx
  const [rightsHolderDraft, setRightsHolderDraft] = useState(project?.project.rights_holder ?? "");
  const [rightsBusy, setRightsBusy] = useState(false);
  useEffect(() => {
    setRightsHolderDraft(project?.project.rights_holder ?? "");
  }, [project?.project.rights_holder]);

  const onToggleRights = () => {
    setRightsBusy(true);
    void (async () => {
      try {
        await saveRights(!project?.project.rights_attested_at, rightsHolderDraft.trim() || undefined);
      } catch (e) {
        Alert.alert("Couldn't save", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Please try again.");
      } finally {
        setRightsBusy(false);
      }
    })();
  };

  const onSaveRightsHolder = () => {
    setRightsBusy(true);
    void (async () => {
      try {
        await saveRights(!!project?.project.rights_attested_at, rightsHolderDraft.trim() || undefined);
      } catch (e) {
        Alert.alert("Couldn't save", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Please try again.");
      } finally {
        setRightsBusy(false);
      }
    })();
  };
```

Add the `rightsMetadata` helper as a module-level function near `artifactToBook`'s usage — insert right before `function BookGenSurface(...)` (`mobile/app/trust/[projectId].tsx:60`):

```tsx
// Threads the project's rights attestation (B3 Part B) into the exported
// book's dc:rights colophon line. compiler/src/colophon.ts already falls
// back to "© <year> <author>. All rights reserved." when metadata.rights is
// absent, so this only needs to supply a line when the OWNER has actually
// attested AND named a rights holder — an unattested project exports with
// the compiler's default colophon behavior, unchanged.
function rightsMetadata(project: ProjectView): BookMetadata | undefined {
  if (!project.rights_attested_at || !project.rights_holder) return undefined;
  const year = new Date(project.rights_attested_at).getUTCFullYear();
  return { rights: `© ${year} ${project.rights_holder}. All rights reserved.` };
}
```

Edit `mobile/app/trust/[projectId].tsx:23` — change:

```tsx
import type { Book, StructuredTOC, Subtopic } from "@/types/book";
```

to:

```tsx
import type { Book, BookMetadata, StructuredTOC, Subtopic } from "@/types/book";
```

Edit `mobile/app/trust/[projectId].tsx:20` — change:

```tsx
import type { ArtifactDetailView, DraftSection, GenerationJob, ProjectFeedbackItem, ProjectInputView, StructuredTocUnit, StructuredTocView, TopicStatusView } from "@/api/trustClient";
```

to:

```tsx
import type { ArtifactDetailView, DraftSection, GenerationJob, ProjectFeedbackItem, ProjectInputView, ProjectView, StructuredTocUnit, StructuredTocView, TopicStatusView } from "@/api/trustClient";
```

Thread `rightsMetadata(project.project)` into the 4 export call sites:

Edit `mobile/app/trust/[projectId].tsx:1797` — change:

```tsx
        const book = artifactToBook(v.content?.sections ?? [], title, inputs);
```

(inside `onAddToLibrary`) to:

```tsx
        const book = artifactToBook(v.content?.sections ?? [], title, inputs, rightsMetadata(project.project));
```

Edit `mobile/app/trust/[projectId].tsx:1841` — change:

```tsx
        const book = artifactToBook(v.content?.sections ?? [], title, inputs);
```

(inside `onDownloadAsset`) to:

```tsx
        const book = artifactToBook(v.content?.sections ?? [], title, inputs, rightsMetadata(project.project));
```

Edit `mobile/app/trust/[projectId].tsx:1870` — change:

```tsx
    return topicsToBook(project.project.title, toc, sectionsByTopic, inputs);
```

(inside `assembleBook`, feeds both `onPublishToLibrary` and `onPublishDownload`) to:

```tsx
    return topicsToBook(project.project.title, toc, sectionsByTopic, inputs, rightsMetadata(project.project));
```

- [ ] **Step 14: Add the rights UI to `PublishPanel`**

Edit the `PublishPanel` function signature (`mobile/app/trust/[projectId].tsx:1152-1189`) — change:

```tsx
function PublishPanel({
  styles,
  isOwner,
  artifacts,
  inputs,
  pubBusy,
  onCopyAsset,
  onAddToLibrary,
  onDownloadAsset,
  toc,
  topicStatus,
  bookValidated,
  onPublishToLibrary,
  onPublishDownload,
  onUpgrade,
  plan,
}: {
  styles: Styles;
  isOwner: boolean;
  artifacts: ArtifactDetailView[];
  inputs: ProjectInputView[];
  pubBusy: string | null;
  onCopyAsset: (versionId: string, fmt: "text" | "markdown", title: string) => void;
  onAddToLibrary: (versionId: string, title: string, format: string) => void;
  onDownloadAsset: (versionId: string, title: string, fmt: "epub" | "pdf" | "docx") => void;
  toc: StructuredTocView | undefined;
  topicStatus: TopicStatusView[];
  bookValidated: boolean;
  onPublishToLibrary: () => void;
  onPublishDownload: (fmt: "epub" | "pdf" | "docx") => void;
  onUpgrade: () => void;
  plan: PlanStatus | null;
}) {
```

to:

```tsx
function PublishPanel({
  styles,
  theme,
  isOwner,
  artifacts,
  inputs,
  pubBusy,
  onCopyAsset,
  onAddToLibrary,
  onDownloadAsset,
  toc,
  topicStatus,
  bookValidated,
  onPublishToLibrary,
  onPublishDownload,
  onUpgrade,
  plan,
  rightsAttestedAt,
  rightsHolderDraft,
  setRightsHolderDraft,
  rightsBusy,
  onToggleRights,
  onSaveRightsHolder,
}: {
  styles: Styles;
  theme: Palette;
  isOwner: boolean;
  artifacts: ArtifactDetailView[];
  inputs: ProjectInputView[];
  pubBusy: string | null;
  onCopyAsset: (versionId: string, fmt: "text" | "markdown", title: string) => void;
  onAddToLibrary: (versionId: string, title: string, format: string) => void;
  onDownloadAsset: (versionId: string, title: string, fmt: "epub" | "pdf" | "docx") => void;
  toc: StructuredTocView | undefined;
  topicStatus: TopicStatusView[];
  bookValidated: boolean;
  onPublishToLibrary: () => void;
  onPublishDownload: (fmt: "epub" | "pdf" | "docx") => void;
  onUpgrade: () => void;
  plan: PlanStatus | null;
  rightsAttestedAt: string | null;
  rightsHolderDraft: string;
  setRightsHolderDraft: (v: string) => void;
  rightsBusy: boolean;
  onToggleRights: () => void;
  onSaveRightsHolder: () => void;
}) {
```

`Palette` is already imported at `mobile/app/trust/[projectId].tsx:28` (`import { radius, spacing, typography, type Palette } from "@/constants/theme";`) — `useTheme(): Palette` (`mobile/src/theme/ThemeProvider.tsx:49`), and `styles.makeStyles` already takes a `Palette` (line 2184) — no new import needed for this type.

Insert the rights block as the very first thing inside `PublishPanel`'s `return (...)`, before the `{hasToc ? (...)}` block (`mobile/app/trust/[projectId].tsx:1204-1206`) — change:

```tsx
  return (
    <View style={styles.artifactsWrap}>
      {hasToc ? (
```

to:

```tsx
  return (
    <View style={styles.artifactsWrap}>
      {isOwner ? (
        <View style={styles.artifact}>
          <Text style={styles.artifactTitle}>Rights</Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="I attest I hold the rights to my sources"
            accessibilityState={{ checked: !!rightsAttestedAt }}
            onPress={onToggleRights}
            style={styles.inviteRow}
          >
            <Chip label={rightsAttestedAt ? "Attested ✓" : "Not attested"} active={!!rightsAttestedAt} />
            <Text style={styles.sourcesHelper}>I attest I hold the rights to the sources I've used and that this is my original work.</Text>
          </Pressable>
          <TextInput
            style={styles.inviteInput}
            accessibilityLabel="Rights holder"
            placeholder="Rights holder (optional)"
            placeholderTextColor={theme.textMuted}
            value={rightsHolderDraft}
            onChangeText={setRightsHolderDraft}
          />
          <Button
            variant="ghost"
            label="Save rights holder"
            accessibilityLabel="Save rights holder"
            busy={rightsBusy}
            onPress={onSaveRightsHolder}
          />
        </View>
      ) : null}
      <Text style={styles.sourcesHelper}>Originality & rights are the author's responsibility — Mentible does not verify copyright or run a plagiarism scan against the web.</Text>
      {hasToc ? (
```

- [ ] **Step 15: Update the `<PublishPanel .../>` call site**

Edit `mobile/app/trust/[projectId].tsx:2154-2172` — change:

```tsx
        {active === "share" ? (
          <PublishPanel
            styles={styles}
            isOwner={isOwner}
            artifacts={project.artifacts}
            inputs={inputs}
            pubBusy={pubBusy}
            onCopyAsset={onCopyAsset}
            onAddToLibrary={onAddToLibrary}
            onDownloadAsset={onDownloadAsset}
            toc={project.project.toc}
            topicStatus={project.topic_status ?? []}
            bookValidated={project.book_validated ?? false}
            onPublishToLibrary={onPublishToLibrary}
            onPublishDownload={onPublishDownload}
            onUpgrade={onUpgrade}
            plan={plan}
          />
        ) : null}
```

to:

```tsx
        {active === "share" ? (
          <PublishPanel
            styles={styles}
            theme={theme}
            isOwner={isOwner}
            artifacts={project.artifacts}
            inputs={inputs}
            pubBusy={pubBusy}
            onCopyAsset={onCopyAsset}
            onAddToLibrary={onAddToLibrary}
            onDownloadAsset={onDownloadAsset}
            toc={project.project.toc}
            topicStatus={project.topic_status ?? []}
            bookValidated={project.book_validated ?? false}
            onPublishToLibrary={onPublishToLibrary}
            onPublishDownload={onPublishDownload}
            onUpgrade={onUpgrade}
            plan={plan}
            rightsAttestedAt={project.project.rights_attested_at}
            rightsHolderDraft={rightsHolderDraft}
            setRightsHolderDraft={setRightsHolderDraft}
            rightsBusy={rightsBusy}
            onToggleRights={onToggleRights}
            onSaveRightsHolder={onSaveRightsHolder}
          />
        ) : null}
```

- [ ] **Step 16: Run the screen test, confirm it passes**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail.rights.test.tsx`
Expected: all 5 passed.

- [ ] **Step 17: Run the broader Publish/TrustProjectDetail suite for regressions**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail.publish.test.tsx __tests__/screens/TrustProjectDetail.publishbook.test.tsx __tests__/screens/TrustPublish.word.test.tsx`
Expected: all passed (the rights block is additive and sits above the existing toc-mode logic, which is untouched).

- [ ] **Step 18: Add the Help feature, topic, and tree leaf**

Edit `mobile/src/help-content/features.ts` — change the line added in Task 4:

```ts
  { key: "originality-report", label: "Originality check (source overlap)" },
```

to also add, right after it:

```ts
  { key: "originality-report", label: "Originality check (source overlap)" },
  { key: "project-rights", label: "Rights & attribution (copyright)" },
```

Edit `mobile/src/help-content/topics.ts` — insert a new topic right after the `originality-report` topic added in Task 4 (before `generate-full-book`):

```ts
  {
    id: "project-rights",
    title: "Rights & attribution",
    featureKey: "project-rights",
    keywords: ["rights", "copyright", "attribution", "colophon", "dc:rights", "holder", "attest"],
    blocks: [
      {
        kind: "text",
        text: "On the Publish tab, the project owner can attest \"I hold the rights to the sources I've used and that this is my original work\" and optionally name a rights holder. This is a statement you make, not something Mentible verifies — see the originality check for the closest thing to an automated signal, and note that it only compares against your OWN cited sources, never the web.",
      },
      {
        kind: "text",
        text: "When attested with a rights holder set, the exported EPUB/PDF's copyright page carries a \"© <year> <rights holder>. All rights reserved.\" line. Leaving it unattested doesn't block anything — export always works; the colophon just falls back to a generic line.",
      },
      {
        kind: "text",
        text: "Originality and rights are entirely the author's responsibility. Mentible does not run a plagiarism scan against the internet and does not verify copyright ownership.",
      },
    ],
  },
```

Edit `mobile/src/help-content/tree.ts:58-67` (the `projects-publish` node — after Task 4 this node is unchanged, so its content is still exactly as follows) — change:

```ts
      {
        id: "projects-publish",
        title: "Publish",
        children: [
          { id: "leaf-project-publish", title: "Exporting & sharing validated work", topicId: "project-publish" },
          { id: "leaf-word-export", title: "Word (.docx) export", topicId: "word-export" },
          { id: "leaf-kdp-export", title: "Kindle (KDP) export", topicId: "kdp-export" },
          { id: "leaf-publish-pack", title: "Publish pack (for retailers)", topicId: "publish-pack" },
        ],
      },
```

to:

```ts
      {
        id: "projects-publish",
        title: "Publish",
        children: [
          { id: "leaf-project-publish", title: "Exporting & sharing validated work", topicId: "project-publish" },
          { id: "leaf-word-export", title: "Word (.docx) export", topicId: "word-export" },
          { id: "leaf-kdp-export", title: "Kindle (KDP) export", topicId: "kdp-export" },
          { id: "leaf-publish-pack", title: "Publish pack (for retailers)", topicId: "publish-pack" },
          { id: "leaf-project-rights", title: "Rights & attribution", topicId: "project-rights" },
        ],
      },
```

- [ ] **Step 19: Run the Help gates**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts __tests__/help/tree.test.ts`
Expected: all passed.

- [ ] **Step 20: Run the full mobile suite for a final regression pass**

Run: `cd mobile && npx jest`
Expected: all passed.

- [ ] **Step 21: Commit**

```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts mobile/src/lib/artifactToBook.ts mobile/src/lib/topicsToBook.ts mobile/app/trust/\[projectId\].tsx mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/src/help-content/tree.ts mobile/__tests__/lib/artifactToBook.test.ts mobile/__tests__/lib/topicsToBook.test.ts mobile/__tests__/hooks/useTrustProject.test.tsx mobile/__tests__/screens/TrustProjectDetail.rights.test.tsx
git commit -m "feat(mobile): rights attestation on Publish + dc:rights colophon thread (B3 Part B T5)"
```

---

## Rollout

Backend: apply migrations `0022` (`version_originality`) then `0023` (`project rights`) via `alembic upgrade head` on the prod-DB refresh (see `Plans/PROD_BACKEND_REFRESH_TO_MAIN.md` — ROOT-only, `--no-cache` mandatory), then deploy the backend image. Mobile: ships with the next web deploy (`scripts/deploy/web-deploy.sh app`) and the next APK build. No new environment variables, no new external service, no dormant feature flag — the whole slice is in-product and live the moment both sides deploy. Owner-only billable originality checks meter managed spend exactly like grounding (verified in Task 2's `test_managed_originality_check_records_one_usage_event_with_observed_tokens`); rights attestation never touches billing.
