# P1-4 — Grounding & readability quality report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every trust version a quality report — deterministic source-coverage + readability, plus an on-demand LLM claim-grounding pass — surfaced on the trust workspace and (as section coverage) in the exported artifact's trust manifest.

**Architecture:** A deterministic tier (`trust/quality.py`, pure functions over the version's `content.sections` + the project's live input ids) computed on version read, and an LLM tier (`trust/grounding.py`, an owner-only billable Celery job mirroring `generate_version`) that labels each sentence supported/partial/unsupported against its section's cited sources and persists to a new `version_grounding` table. Both surface through `VersionDetailOut.quality`; the export path carries `source_ids` into the compile book so `export/trust.py` can populate the manifest's `SourcingBlock`.

**Tech Stack:** FastAPI + asyncpg + Celery + Redis (backend), the vendored `wegofwd_llm` LLM seam (`generate_validated`/`build_provider`/`LLMRequest`), pytest; React Native + Expo + jest (mobile); the Node `docx`/EPUB compiler (TypeScript) for the manifest field.

**Spec:** `docs/superpowers/specs/2026-08-17-grounding-readability-quality-report-design.md`

## Global Constraints

- **BYOK/ADR-001:** the grounding LLM call obeys generation's discipline — key never logged/persisted, resolved by the **worker** (managed vault `get_managed_key` or BYOK Redis envelope `decrypt_api_key`); section bodies + source text are content and must never be logged.
- **Access:** grounding-check is **owner-only** (`_require_role(..., allow=("owner",))`); reading `quality` follows the existing version-read access (`allow=("owner","reviewer","editor")`).
- **No RLS / no tenant column** (backend rule #4). `version_grounding` is app-level, keyed by version.
- Migrations additive + backward-compatible; the deterministic tier degrades to absent for old data. **Next migration revision is `0021`, down_revision `0020`.**
- asyncpg; no key/content in logs; **70% coverage gate**; the mandatory no-key-in-logs test path stays green.
- Mobile: `useThemedStyles`; **no color-literal assertions in tests**; `npx tsc --noEmit` + full `npx jest` + `npx eslint .` green.
- **Definition of Done (Help gate):** the grounding-report feature needs a `FEATURES` key + a Help topic in the SAME task (T6), or `mobile/__tests__/help/coverage.test.ts` fails.
- Claim = sentence. Report field names are exact (below). Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Backend:**
- Create `backend/src/trust/quality.py` — pure `coverage_report` / `readability` / `version_quality` (T1).
- Create `backend/src/trust/grounding.py` — `build_grounding_prompt` + `generate_grounding` (T3).
- Create `backend/src/trust/grounding_repo.py` — upsert/get `version_grounding` (T4).
- Create `backend/alembic/versions/0021_version_grounding.py` (T4).
- Modify `backend/src/trust/router.py` — attach `quality` to the two GET details (T2); two grounding-check endpoints (T4).
- Modify `backend/src/trust/schemas.py` — `quality` field on the two detail Outs (T2).
- Modify `backend/src/trust/tasks.py` — `grounding_check_task` (T4).
- Modify `backend/src/export/trust.py` — `compute_sourcing` + attach `SourcingBlock` (T5).
- Tests: `backend/tests/test_trust_quality.py` (T1), `test_trust_grounding.py` (T3), `test_trust_grounding_endpoint.py` (T4), extend the export-trust test (T5).

**Compiler:**
- Modify `compiler/src/types.ts` — additive optional `source_ids?: string[]` on `LessonSection` (T5).

**Mobile:**
- Modify `mobile/src/api/trustClient.ts` — `quality` on the two detail views + `QualityReport` types + `runGroundingCheck`/`runTopicGroundingCheck` (T6).
- Modify `mobile/src/lib/topicsToBook.ts` + `artifactToBook.ts` — carry `source_ids` into `LessonSection` (T5).
- Create `mobile/src/components/QualityCard.tsx` (T6).
- Modify `mobile/app/trust/version/[versionId].tsx` + `topic-version/[id].tsx` — render the card + per-section indicators + owner run button (T6).
- Modify `mobile/src/help-content/features.ts` + `topics.ts` (T6).
- Tests: `mobile/__tests__/screens/QualityCard.test.tsx` or extend the trust version tests (T6).

---

## Report shape (canonical — every task uses these exact keys)

```jsonc
quality = {
  "coverage": {
    "sections_total": 10, "sections_cited": 8,
    "uncited_section_indexes": [3, 7],
    "dangling": [{"section_index": 5, "source_id": "…"}],
    "source_refs": 4
  },
  "readability": { "flesch_reading_ease": 42.1, "grade_level": 11.2, "words": 812, "sentences": 41 },
  "grounding": null | {
    "claims_total": 47, "supported": 41, "partial": 3, "unsupported": 3,
    "by_section": [{"section_index": 0, "claims": [{"text": "…", "status": "supported", "source_ids": ["…"]}]}],
    "model": "claude-sonnet-4-6", "checked_at": "2026-08-17T…Z", "stale": false
  }
}
```

---

## Task 1: Deterministic analysis (`backend/src/trust/quality.py`)

**Files:** Create `backend/src/trust/quality.py`; Test `backend/tests/test_trust_quality.py`.

**Interfaces:**
- Produces: `coverage_report(sections: list[dict], live_input_ids: set[str]) -> dict`; `readability(text: str) -> dict`; `version_quality(sections: list[dict], live_input_ids: set[str]) -> dict` (returns `{"coverage": …, "readability": …}`).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_trust_quality.py
from backend.src.trust.quality import coverage_report, readability, version_quality

def test_coverage_counts_cited_uncited_and_dangling():
    sections = [
        {"heading": "A", "body": "x", "source_ids": ["s1"]},        # cited
        {"heading": "B", "body": "y", "source_ids": []},            # uncited
        {"heading": "C", "body": "z", "source_ids": ["gone"]},      # dangling only → uncited
    ]
    rep = coverage_report(sections, {"s1", "s2"})
    assert rep["sections_total"] == 3
    assert rep["sections_cited"] == 1
    assert rep["uncited_section_indexes"] == [1, 2]
    assert rep["dangling"] == [{"section_index": 2, "source_id": "gone"}]
    assert rep["source_refs"] == 1

def test_readability_on_a_known_string():
    # "The cat sat on the mat. The dog ran fast." → 2 sentences, 10 words.
    r = readability("The cat sat on the mat. The dog ran fast.")
    assert r["sentences"] == 2
    assert r["words"] == 10
    assert r["grade_level"] < 3          # short, simple → low grade
    assert 90 < r["flesch_reading_ease"] <= 122

def test_readability_strips_math_and_code_and_guards_empty():
    r = readability("Energy $E=mc^2$ is famous.\n\n```mermaid\ngraph TD\n```")
    assert r["words"] >= 3               # math/code stripped, prose counted
    assert readability("")["sentences"] == 0     # divide-by-zero guarded
    assert readability("")["grade_level"] == 0.0

def test_version_quality_bundles_both():
    q = version_quality([{"heading": "A", "body": "One two three.", "source_ids": ["s1"]}], {"s1"})
    assert set(q) == {"coverage", "readability"}
```

- [ ] **Step 2: Run — expect FAIL** (`cd backend && pytest tests/test_trust_quality.py -v` → module not found)

- [ ] **Step 3: Implement `quality.py`**

```python
# backend/src/trust/quality.py
"""Deterministic per-version quality analysis (P1-4) — pure, no LLM, no I/O.

Two facts about a trust version, computed from its `content.sections` and the
project's LIVE input ids:
  - coverage: how many sections cite a source that still exists (uncited /
    dangling flagged) — reads the model-declared `source_ids` already on each
    section; it does NOT verify claims (that's the LLM tier, grounding.py).
  - readability: Flesch reading-ease + Flesch-Kincaid grade over the prose.
"""

from __future__ import annotations

import re


def coverage_report(sections: list[dict], live_input_ids: set[str]) -> dict:
    uncited: list[int] = []
    dangling: list[dict] = []
    cited_ids: set[str] = set()
    for i, sec in enumerate(sections):
        ids = sec.get("source_ids") or []
        live = [sid for sid in ids if sid in live_input_ids]
        cited_ids.update(live)
        if not live:
            uncited.append(i)
        for sid in ids:
            if sid not in live_input_ids:
                dangling.append({"section_index": i, "source_id": sid})
    return {
        "sections_total": len(sections),
        "sections_cited": len(sections) - len(uncited),
        "uncited_section_indexes": uncited,
        "dangling": dangling,
        "source_refs": len(cited_ids),
    }


_FENCE = re.compile(r"```.*?```", re.DOTALL)          # code / mermaid fences
_MATH = re.compile(r"\${1,2}[^$]*\${1,2}")            # $…$ / $$…$$
_MD = re.compile(r"[#*_>`\[\]()!~|-]")                 # markdown punctuation
_WORD = re.compile(r"[A-Za-z][A-Za-z'-]*")
_SENT = re.compile(r"[.!?]+")


def _syllables(word: str) -> int:
    w = word.lower()
    groups = re.findall(r"[aeiouy]+", w)
    n = len(groups)
    if w.endswith("e") and n > 1:        # silent trailing 'e'
        n -= 1
    return max(1, n)


def readability(text: str) -> dict:
    clean = _MD.sub(" ", _MATH.sub(" ", _FENCE.sub(" ", text or "")))
    words = _WORD.findall(clean)
    sentences = max(0, len([s for s in _SENT.split(clean) if s.strip()]))
    n_words, n_sent = len(words), sentences
    if n_words == 0 or n_sent == 0:
        return {"flesch_reading_ease": 0.0, "grade_level": 0.0, "words": n_words, "sentences": n_sent}
    syl = sum(_syllables(w) for w in words)
    wps, spw = n_words / n_sent, syl / n_words
    ease = 206.835 - 1.015 * wps - 84.6 * spw
    grade = 0.39 * wps + 11.8 * spw - 15.59
    return {
        "flesch_reading_ease": round(ease, 1),
        "grade_level": round(max(0.0, grade), 1),
        "words": n_words,
        "sentences": n_sent,
    }


def version_quality(sections: list[dict], live_input_ids: set[str]) -> dict:
    body = "\n\n".join(s.get("body") or "" for s in sections)
    return {"coverage": coverage_report(sections, live_input_ids), "readability": readability(body)}
```

- [ ] **Step 4: Run — expect PASS** (`cd backend && pytest tests/test_trust_quality.py -v`). If the Flesch bound on the known string fails, hand-compute syllables for that exact sentence and adjust the test bound (not the formula) — the formula is standard.

- [ ] **Step 5: Commit**

```bash
git add backend/src/trust/quality.py backend/tests/test_trust_quality.py
git commit -m "feat(trust): deterministic coverage + readability analysis (P1-4 T1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Attach the deterministic tier to version reads

**Files:** Modify `backend/src/trust/schemas.py`, `backend/src/trust/router.py`; Modify `mobile/src/api/trustClient.ts`. Test: extend `backend/tests/` version-detail coverage (add to the nearest existing get_version test or a new `test_trust_version_quality.py`).

**Interfaces:**
- Consumes: `version_quality` (T1); `project_repo.list_inputs(conn, project_id=…)` → input rows with `.id`.
- Produces: `VersionDetailOut.quality: dict | None`, `TopicVersionDetailOut.quality: dict | None`; TS `VersionDetailView.quality?` / `TopicVersionDetailView.quality?`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_trust_version_quality.py  (mirror an existing get_version test's fixtures/harness)
# After creating a project + input + an artifact version whose content.sections
# cite that input, GET /api/v1/trust/versions/{id} and assert:
#   body["quality"]["coverage"]["sections_total"] >= 1
#   "readability" in body["quality"]
#   body["quality"]["grounding"] is None      # no LLM run yet (Task 4 adds runs)
```

- [ ] **Step 2: Run — expect FAIL** (`quality` KeyError / None).

- [ ] **Step 3: Add the schema fields**

```python
# backend/src/trust/schemas.py — add to BOTH VersionDetailOut and TopicVersionDetailOut:
    quality: dict | None = None
```

- [ ] **Step 4: Populate in both GET handlers**

In `get_version` (`router.py:291`) and `get_topic_version` (`router.py:1010`), after loading the version and BEFORE the `return schemas.…DetailOut(`, compute the deterministic tier and the (nullable) stored grounding:

```python
from .quality import version_quality
from . import grounding_repo           # exists after Task 4; guard import for T2 (see note)

# ... inside get_version, after `v = await artifact_repo.get_version(...)`:
live_ids = {str(i.id) for i in await project_repo.list_inputs(conn, project_id=project_id)}
q = version_quality((v.content or {}).get("sections", []), live_ids)
q["grounding"] = None   # Task 4 replaces this with the stored report (+ stale)
```

Pass `quality=q` into the `VersionDetailOut(...)` / `TopicVersionDetailOut(...)` constructor. **T2 note:** `grounding_repo` does not exist until Task 4 — in T2 set `q["grounding"] = None` inline and do NOT import `grounding_repo`; Task 4 adds the import + the real lookup. (Topic path uses `(tv.content or {}).get("sections", [])`.)

- [ ] **Step 5: Add the TS fields**

```ts
// mobile/src/api/trustClient.ts — add to VersionDetailView and TopicVersionDetailView:
  quality?: QualityReport | null;
// and define (near DraftSection):
export interface CoverageReport { sections_total: number; sections_cited: number; uncited_section_indexes: number[]; dangling: { section_index: number; source_id: string }[]; source_refs: number }
export interface Readability { flesch_reading_ease: number; grade_level: number; words: number; sentences: number }
export interface GroundingReport { claims_total: number; supported: number; partial: number; unsupported: number; by_section: { section_index: number; claims: { text: string; status: "supported" | "partial" | "unsupported"; source_ids: string[] }[] }[]; model: string; checked_at: string; stale: boolean }
export interface QualityReport { coverage: CoverageReport; readability: Readability; grounding: GroundingReport | null }
```

- [ ] **Step 6: Run — expect PASS** (`cd backend && pytest tests/test_trust_version_quality.py -v`; `cd mobile && npx tsc --noEmit`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/trust/schemas.py backend/src/trust/router.py backend/tests/test_trust_version_quality.py mobile/src/api/trustClient.ts
git commit -m "feat(trust): surface coverage+readability on version detail (P1-4 T2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: LLM claim-grounding module (`backend/src/trust/grounding.py`)

**Files:** Create `backend/src/trust/grounding.py`; Test `backend/tests/test_trust_grounding.py`.

**Interfaces:**
- Consumes: the LLM seam used by `generate.py` — `build_provider(provider_id, *, api_key, model)`, `LLMRequest(prompt, max_tokens, response_format)`, `generate_validated(provider, req, validate, max_repairs)`, `parse_json_response(text)` (import the SAME names `backend/src/trust/generate.py` imports — check its import block).
- Produces: `build_grounding_prompt(heading: str, body: str, cited: list[tuple[str, str]]) -> str` (each `cited` = `(label, content)`); `generate_grounding(*, sections: list[dict], sources: list, provider_id: str, api_key: str, model: str) -> dict` returning the `grounding` report shape (minus `checked_at`/`stale`, which the task/read layer stamp). `sources` is the list of input rows (with `.id`, `.content`) — the same objects `generate_draft` receives.

- [ ] **Step 1: Write the failing tests** (mock the provider so no live LLM)

```python
# backend/tests/test_trust_grounding.py
from unittest.mock import patch
from backend.src.trust import grounding

class _Src:  # minimal stand-in for a ProjectInput row
    def __init__(self, id, content): self.id, self.content = id, content

def test_uncited_section_is_all_unsupported_without_an_llm_call():
    sections = [{"heading": "H", "body": "A claim.", "source_ids": []}]
    with patch("backend.src.trust.grounding.generate_validated") as gv:
        rep = grounding.generate_grounding(sections=sections, sources=[_Src("s1", "text")],
                                           provider_id="anthropic", api_key="k", model="m")
        gv.assert_not_called()                       # no cited source → no LLM call
    assert rep["claims_total"] == 1 and rep["unsupported"] == 1 and rep["supported"] == 0

def test_cited_section_maps_labels_and_aggregates():
    sections = [{"heading": "H", "body": "A. B.", "source_ids": ["s1"]}]
    class _Res:  # mimic ConformanceResult
        parsed = type("P", (), {"claims": [
            type("C", (), {"text": "A.", "status": "supported", "sources": ["S1"]})(),
            type("C", (), {"text": "B.", "status": "unsupported", "sources": []})(),
        ]})()
        total_input_tokens = total_output_tokens = 0
    with patch("backend.src.trust.grounding.generate_validated", return_value=_Res()):
        rep = grounding.generate_grounding(sections=sections, sources=[_Src("s1", "src text")],
                                           provider_id="anthropic", api_key="k", model="m")
    assert rep["claims_total"] == 2 and rep["supported"] == 1 and rep["unsupported"] == 1
    by = rep["by_section"][0]["claims"]
    assert by[0]["source_ids"] == ["s1"]             # S1 → real input id
    assert by[1]["source_ids"] == []
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

- [ ] **Step 3: Implement `grounding.py`**

```python
# backend/src/trust/grounding.py
"""LLM claim-grounding (P1-4) — per section, split the body into sentence-level
claims and label each supported/partial/unsupported against ONLY that section's
cited sources. Reuses the generate.py conformance loop; the caller (tasks.py)
resolves the key and persists the result. Mirrors generate.py's imports."""

from __future__ import annotations

from pydantic import BaseModel, Field

from .generate import build_provider, generate_validated, parse_json_response, LLMRequest

_MAX_TOKENS = 8192
_MAX_REPAIRS = 2
_STATUSES = {"supported", "partial", "unsupported"}


class _Claim(BaseModel):
    text: str
    status: str
    sources: list[str] = Field(default_factory=list)


class _GroundingOut(BaseModel):
    claims: list[_Claim]


def build_grounding_prompt(heading: str, body: str, cited: list[tuple[str, str]]) -> str:
    src = "\n\n".join(f'[{label}]\n"""\n{content}\n"""' for label, content in cited)
    return (
        "You are auditing whether a section's claims are supported by its cited sources.\n"
        f"SECTION: {heading}\n\nSOURCES (cite ONLY these labels):\n{src}\n\n"
        f"SECTION TEXT:\n\"\"\"\n{body}\n\"\"\"\n\n"
        "Split the section text into individual sentence-level claims. For EACH claim, decide if the "
        "sources support it: 'supported' (a source states it), 'partial' (related but not fully stated), "
        "or 'unsupported' (no source states it). List the supporting source label(s).\n"
        'Return ONLY JSON: {"claims":[{"text":"<sentence>","status":"supported|partial|unsupported",'
        '"sources":["S1"]}]}'
    )


def _coerce(data) -> _GroundingOut:
    out = _GroundingOut.model_validate(data)
    for c in out.claims:
        if c.status not in _STATUSES:
            c.status = "unsupported"
    return out


def generate_grounding(*, sections, sources, provider_id, api_key, model) -> dict:
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    id_to_label = {v: k for k, v in by_label.items()}
    by_section, totals = [], {"supported": 0, "partial": 0, "unsupported": 0}

    for idx, sec in enumerate(sections):
        body = sec.get("body") or ""
        live_ids = [sid for sid in (sec.get("source_ids") or []) if sid in id_to_label]
        if not live_ids or not body.strip():
            # No cited source (or empty) → every sentence is unsupported, no LLM call.
            claims = [{"text": body.strip(), "status": "unsupported", "source_ids": []}] if body.strip() else []
        else:
            cited = [(id_to_label[sid], _source_content(sources, sid)) for sid in live_ids]
            provider = build_provider(provider_id, api_key=api_key, model=model)
            req = LLMRequest(prompt=build_grounding_prompt(sec.get("heading") or "", body, cited),
                             max_tokens=_MAX_TOKENS, response_format="json")
            res = generate_validated(provider, req, lambda t: _coerce(parse_json_response(t)),
                                     max_repairs=_MAX_REPAIRS)
            claims = [
                {"text": c.text, "status": c.status,
                 "source_ids": [by_label[l] for l in c.sources if l in by_label]}
                for c in res.parsed.claims
            ]
        for c in claims:
            totals[c["status"]] = totals.get(c["status"], 0) + 1
        by_section.append({"section_index": idx, "claims": claims})

    return {
        "claims_total": sum(totals.values()),
        "supported": totals["supported"], "partial": totals["partial"], "unsupported": totals["unsupported"],
        "by_section": by_section, "model": model,
    }


def _source_content(sources, sid: str) -> str:
    for s in sources:
        if str(s.id) == sid:
            return s.content or ""
    return ""
```

> Implementer note: confirm the exact import names against `backend/src/trust/generate.py`'s import block (`build_provider`, `generate_validated`, `parse_json_response`, `LLMRequest` come from the vendored `wegofwd_llm` seam). If `generate.py` re-exports them, import from `.generate` as above; otherwise import from the same origin module `generate.py` uses. `res.parsed` is the validated `_GroundingOut` (`generate_validated` returns a ConformanceResult whose `.parsed` is your `_coerce` output).

- [ ] **Step 4: Run — expect PASS**; **Step 5: Commit**

```bash
git add backend/src/trust/grounding.py backend/tests/test_trust_grounding.py
git commit -m "feat(trust): LLM claim-grounding module (P1-4 T3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Grounding-check endpoint + task + persistence (migration 0021)

**Files:** Create `backend/alembic/versions/0021_version_grounding.py`, `backend/src/trust/grounding_repo.py`; Modify `backend/src/trust/tasks.py`, `backend/src/trust/router.py`, `backend/src/trust/schemas.py`. Test `backend/tests/test_trust_grounding_endpoint.py`.

**Interfaces:**
- Consumes: `generate_grounding` (T3); the key-resolution + job-status boilerplate in `tasks.py:_run_version` / `generate_version_task` (managed `get_managed_key(provider_id)` vs BYOK `decrypt_api_key`, `_write_status`, `_byok_redis_key`, `_record_trust_usage`); the enqueue + eligibility + envelope boilerplate in `router.py:generate_version` (`resolve_managed_access`, `over_cap`, `encrypt_api_key`, `parse_master_key`, `_byok_redis_key`, `_write_status`).
- Produces: `POST /api/v1/trust/artifacts/versions/{version_id}/grounding-check` and `POST /api/v1/trust/topic-versions/{version_id}/grounding-check` → `202 {job_id, status}` (poll `GET /api/v1/jobs/{job_id}`, result `{version_id, version_kind}`); `grounding_repo.upsert(...)` / `grounding_repo.get(...)`.

- [ ] **Step 1: Migration 0021**

```python
# backend/alembic/versions/0021_version_grounding.py
"""version_grounding — stored LLM claim-grounding report per trust version (P1-4)."""
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute("""
        CREATE TABLE version_grounding (
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
    op.execute("DROP TABLE version_grounding")
```

- [ ] **Step 2: `grounding_repo.py`**

```python
# backend/src/trust/grounding_repo.py
"""Persistence for the per-version LLM grounding report (P1-4). Keyed by
(version_id, version_kind); a re-run upserts. `cited_content_hash` lets the read
layer flag a stored report stale when the cited inputs changed."""
from __future__ import annotations

import json
from uuid import UUID

import asyncpg


async def upsert(conn: asyncpg.Connection, *, version_id: UUID, version_kind: str,
                 report: dict, model: str, cited_content_hash: str) -> None:
    await conn.execute(
        """INSERT INTO version_grounding (version_id, version_kind, report, model, cited_content_hash)
           VALUES ($1,$2,$3::jsonb,$4,$5)
           ON CONFLICT (version_id, version_kind)
           DO UPDATE SET report=EXCLUDED.report, model=EXCLUDED.model,
                         cited_content_hash=EXCLUDED.cited_content_hash, checked_at=now()""",
        version_id, version_kind, json.dumps(report), model, cited_content_hash,
    )


async def get(conn: asyncpg.Connection, *, version_id: UUID, version_kind: str) -> dict | None:
    row = await conn.fetchrow(
        "SELECT report, model, checked_at, cited_content_hash FROM version_grounding "
        "WHERE version_id=$1 AND version_kind=$2", version_id, version_kind,
    )
    if row is None:
        return None
    return {**json.loads(row["report"]), "model": row["model"],
            "checked_at": row["checked_at"].isoformat(), "cited_content_hash": row["cited_content_hash"]}
```

- [ ] **Step 3: `cited_content_hash` helper + `grounding_check_task`** in `tasks.py`

Add a small helper (module scope) and the task. The task mirrors `generate_version_task`/`_run_version`'s key-resolution EXACTLY (copy that block); only the middle (load version, call `generate_grounding`, upsert) is new.

```python
# tasks.py — helper
import hashlib
def cited_content_hash(sources, cited_ids: set[str]) -> str:
    h = hashlib.sha256()
    for s in sources:
        if str(s.id) in cited_ids:
            h.update((s.content_hash or "").encode()); h.update(b"|")
    return h.hexdigest()
```

```python
# tasks.py — the task (celery), key-resolution copied from generate_version_task:
@celery_app.task(name="trust.grounding_check")
def grounding_check_task(*, job_id: str, version_id: str, version_kind: str,
                         provider_id: str, model: str, managed: bool) -> None:
    async def _run() -> None:
        # ... open conn + redis exactly as _run_version does ...
        # 1. resolve api_key: managed → get_managed_key(provider_id); else decrypt BYOK envelope
        #    (COPY the resolution + failure `_write_status(...,"failed",...)` branches verbatim).
        # 2. load sections + sources:
        #    if version_kind == "artifact":  v = await artifact_repo.get_version(conn, version_id=UUID(version_id))
        #    else:                            v = await topic_repo.get_topic_version(conn, topic_version_id=UUID(version_id))
        #    project_id via project_id_for_version / project_id_for_topic_version
        #    sections = (v.content or {}).get("sections", [])
        #    sources  = await project_repo.list_inputs(conn, project_id=project_id)
        # 3. report = grounding.generate_grounding(sections=sections, sources=sources,
        #                 provider_id=provider_id, api_key=api_key, model=model)
        # 4. cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
        #    await grounding_repo.upsert(conn, version_id=UUID(version_id), version_kind=version_kind,
        #                 report=report, model=model, cited_content_hash=cited_content_hash(sources, cited))
        # 5. if managed: _record_trust_usage(...) with observed tokens (as _run_version does)
        # 6. await _write_status(r, job_id, "done", result={"version_id": version_id, "version_kind": version_kind})
        ...
    asyncio.run(_run())
```

- [ ] **Step 4: The two endpoints** in `router.py` (mirror `generate_version`'s owner gate + eligibility + envelope + enqueue)

```python
@router.post("/artifacts/versions/{version_id}/grounding-check",
             response_model=schemas.VersionGenerateJobOut, status_code=status.HTTP_202_ACCEPTED,
             dependencies=[Depends(enforce_rate_limit)])
async def grounding_check_version(
    version_id: uuid.UUID, body: schemas.DraftGenerateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn), r: redis.Redis = Depends(get_redis),
) -> schemas.VersionGenerateJobOut:
    project_id = await project_id_for_version(conn, version_id=version_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))     # billable → owner only
    # managed/BYOK eligibility + envelope + enqueue: COPY from generate_version (router.py:378-411),
    # then:
    grounding_check_task.delay(job_id=str(job_id), version_id=str(version_id),
                               version_kind="artifact", provider_id=body.provider_id,
                               model=model, managed=managed)
    return schemas.VersionGenerateJobOut(job_id=str(job_id), status="queued")
```

Add the topic twin `grounding_check_topic_version` at `/topic-versions/{version_id}/grounding-check` with `version_kind="topic"` and `project_id_for` via `topic_repo.project_id_for_topic_version`.

- [ ] **Step 5: Wire the stored grounding into the reads** (finish Task 2's stub)

In `get_version` / `get_topic_version`, replace `q["grounding"] = None` with:

```python
from . import grounding_repo
g = await grounding_repo.get(conn, version_id=version_id, version_kind="artifact")  # "topic" in the topic handler
if g is not None:
    stored_hash = g.pop("cited_content_hash")
    cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
    live = await project_repo.list_inputs(conn, project_id=project_id)
    g["stale"] = stored_hash != cited_content_hash(live, cited)   # import cited_content_hash from .tasks
q["grounding"] = g
```

(`sections` = the `(v.content or {}).get("sections", [])` you already computed for `version_quality`.)

- [ ] **Step 6: Endpoint test**

```python
# backend/tests/test_trust_grounding_endpoint.py (mirror an existing generate-endpoint test's harness)
# - owner submits grounding-check with a BYOK api_key → 202 + job_id
# - a reviewer (non-owner) → 403
# - after upserting a fake report via grounding_repo, GET the version detail →
#   quality.grounding is present with stale == False; editing the cited input's
#   content_hash makes a re-fetched detail report stale == True
```

- [ ] **Step 7: Run migrations + tests** (`cd backend && alembic upgrade head && pytest tests/test_trust_grounding_endpoint.py tests/test_trust_version_quality.py -v`); **Step 8: Commit**

```bash
git add backend/alembic/versions/0021_version_grounding.py backend/src/trust/grounding_repo.py backend/src/trust/tasks.py backend/src/trust/router.py backend/src/trust/schemas.py backend/tests/test_trust_grounding_endpoint.py
git commit -m "feat(trust): grounding-check endpoint + task + version_grounding store (P1-4 T4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Export manifest — carry source_ids into the book + populate SourcingBlock

**Files:** Modify `compiler/src/types.ts`, `mobile/src/lib/topicsToBook.ts`, `mobile/src/lib/artifactToBook.ts`, `backend/src/export/trust.py`. Test: extend the export-trust test (`backend/tests/` — the file covering `attach_export_trust`/`compute_compliance`).

**Interfaces:**
- Produces: `LessonSection.source_ids?: string[]` (compiler type); `compute_sourcing(book: dict) -> SourcingBlock | None` in `export/trust.py`, attached in `attach_export_trust`.

- [ ] **Step 1: Additive compiler type**

```ts
// compiler/src/types.ts — LessonSection gains an optional field (additive; existing books still typecheck):
export interface LessonSection { heading: string; body_markdown: string; source_ids?: string[] }
```

- [ ] **Step 2: Carry source_ids in the two mobile assemblers**

```ts
// mobile/src/lib/topicsToBook.ts — makeLesson maps DraftSection.source_ids through:
const sections: LessonSection[] = secs.map((s) => ({ heading: s.heading, body_markdown: s.body, source_ids: s.source_ids }));
// mobile/src/lib/artifactToBook.ts — same one-line change in its section map.
```

- [ ] **Step 3: Write the failing test** (backend export-trust test)

```python
# assert compute_sourcing over a book whose lesson sections carry source_ids:
#   - a book where every section has >=1 source_id → SourcingBlock.every_claim_cited is True, source_refs == distinct count
#   - a book with an uncited section → every_claim_cited False
#   - a book whose sections carry NO source_ids field → compute_sourcing returns None (block omitted)
# and assert attach_export_trust now includes the sourcing block when present.
```

- [ ] **Step 4: Implement `compute_sourcing` + attach** in `export/trust.py`

```python
from wegofwd_llm.trust import SourcingBlock   # confirm import path against the vendored engine

def compute_sourcing(book: dict) -> SourcingBlock | None:
    seen_any = False
    all_cited = True
    refs: set[str] = set()
    for topic in (book.get("content") or {}).values():
        for sec in ((topic.get("lesson") or {}).get("sections") or []):
            if "source_ids" not in sec:
                continue
            seen_any = True
            ids = sec.get("source_ids") or []
            refs.update(ids)
            if (sec.get("body_markdown") or "").strip() and not ids:
                all_cited = False
    if not seen_any:
        return None                       # older/ungrounded book → block omitted (stays "not assessed")
    return SourcingBlock(every_claim_cited=all_cited, source_refs=len(refs))
```

In `attach_export_trust`, after attaching compliance/integrity, compute and attach sourcing when non-None (mirror how compliance is attached). **Scope note (spec §Unit E):** this is the deterministic section-coverage reading; the LLM claim verdict is workspace-only this cut.

- [ ] **Step 5: Run — expect PASS** (`cd backend && pytest tests/ -k "trust and export" -v`; `cd compiler && npx tsc --noEmit`; `cd mobile && npx tsc --noEmit`); **Step 6: Commit**

```bash
git add compiler/src/types.ts mobile/src/lib/topicsToBook.ts mobile/src/lib/artifactToBook.ts backend/src/export/trust.py backend/tests/
git commit -m "feat(export): populate manifest SourcingBlock from section coverage (P1-4 T5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Mobile surfaces — quality card, run button, per-section indicators, Help

**Files:** Modify `mobile/src/api/trustClient.ts`; Create `mobile/src/components/QualityCard.tsx`; Modify `mobile/app/trust/version/[versionId].tsx`, `mobile/app/trust/topic-version/[id].tsx`, `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`. Test `mobile/__tests__/screens/QualityCard.test.tsx`.

**Interfaces:**
- Consumes: `VersionDetailView.quality` / `TopicVersionDetailView.quality` (T2/T4); the shared job poll (`@/api/pollJob`, as `generateVersion`/`generateTopic` use).
- Produces: `runGroundingCheck(versionId, body, token)` / `runTopicGroundingCheck(versionId, body, token)` in `trustClient.ts`; `<QualityCard quality=… isOwner=… onRunGrounding=… busy=… />`.

- [ ] **Step 1: Client calls**

```ts
// mobile/src/api/trustClient.ts — mirror generateVersion's shape:
export async function runGroundingCheck(versionId: string, body: { api_key?: string; provider_id?: string; model?: string }, token: string): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(`/artifacts/versions/${versionId}/grounding-check`, token, { method: "POST", body: JSON.stringify(body) })) as VersionGenerateJobOut;
}
export async function runTopicGroundingCheck(versionId: string, body: { api_key?: string; provider_id?: string; model?: string }, token: string): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(`/topic-versions/${versionId}/grounding-check`, token, { method: "POST", body: JSON.stringify(body) })) as VersionGenerateJobOut;
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// mobile/__tests__/screens/QualityCard.test.tsx  (uses useThemedStyles; NO color-literal asserts)
// - renders coverage "8/10 sections cite a source" + readability "Grade 11.2" from a quality prop
// - grounding null → shows the "Run grounding check" button for an owner, hidden for non-owner
// - grounding present → shows "41/47 claims supported" and a "stale" note when quality.grounding.stale
```

- [ ] **Step 3: Implement `QualityCard.tsx`**

Build with `useThemedStyles` (mirror an existing card component's theming, e.g. the validation badge block in `version/[versionId].tsx`). Props: `{ quality: QualityReport | null | undefined; isOwner: boolean; busy: boolean; onRunGrounding: () => void }`. Render nothing when `quality` is null/undefined (fail-open for older backends). Show:
- Coverage line: `${coverage.sections_cited}/${coverage.sections_total} sections cite a source` + an "uncited: N / dangling: N" sub-note when `uncited_section_indexes.length || dangling.length`.
- Readability line: `Grade ${grade_level} · Flesch ${flesch_reading_ease}` with a caption "directional estimate".
- Grounding: if `grounding` → `${grounding.supported}/${grounding.claims_total} claims supported` (+ partial/unsupported counts), plus a "checked {checked_at}" and, when `grounding.stale`, "inputs changed — re-run". If `grounding` is null and `isOwner` → the `Button label="Run grounding check"` (busy when `busy`).

- [ ] **Step 4: Mount it in both version screens**

In `version/[versionId].tsx` (header, near the validation badge ~`:355-390`) and `topic-version/[id].tsx` (~`:290`): render `<QualityCard quality={version?.quality} isOwner={isOwner} busy={grBusy} onRunGrounding={onRunGrounding} />`. Add an `onRunGrounding` handler that calls `runGroundingCheck`/`runTopicGroundingCheck` with the same key body the generate/Revise action uses, polls the job (`pollJob`), then refetches the version so `quality.grounding` refreshes; guard with a `grBusy` state. Gate the button on `isOwner` (already computed in both screens per the P0-2 role split). Per-section indicator: where the section source-chip row renders, tint/annotate each section by `quality.coverage` (uncited/dangling) and, when `quality.grounding` exists, mark sections with `unsupported` claims.

- [ ] **Step 5: Help DoD** — add a `grounding-report` key to `mobile/src/help-content/features.ts` and a Help topic in `topics.ts` with that `featureKey` (explains coverage, readability as directional, and the on-demand grounding check being a billable LLM pass).

- [ ] **Step 6: Run the gates** (`cd mobile && npx tsc --noEmit && npx jest && npx eslint .` — all green incl. help/coverage + the new test); **Step 7: Commit**

```bash
git add mobile/src/api/trustClient.ts mobile/src/components/QualityCard.tsx "mobile/app/trust/version/[versionId].tsx" "mobile/app/trust/topic-version/[id].tsx" mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/__tests__/screens/QualityCard.test.tsx
git commit -m "feat(trust): quality card + grounding-check UI (P1-4 T6)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Unit A→T1; Unit B→T2; Unit C→T3; Unit D→T4 (migration 0021, endpoints, task, persistence, stale); Unit E→T5 (source_ids into book + SourcingBlock); Unit F→T6 (card, run button, per-section, Help). All covered. Deferred items (claim-level in manifest, readability in manifest, plagiarism) are out-of-scope in both spec and plan.

**Placeholder scan:** T4's task body intentionally references "COPY from generate_version / _run_version" for the key-resolution + job-status boilerplate rather than reproducing ~80 lines of BYOK/managed handling — the exact source functions + line anchors are named, which is the established pattern for this repo's async LLM jobs; the NEW logic (migration, repo, aggregation, endpoint gate, stale) is given in full. Every other step has complete code.

**Type consistency:** report keys (`coverage`/`readability`/`grounding`, `sections_cited`, `uncited_section_indexes`, `dangling`, `source_refs`, `flesch_reading_ease`, `grade_level`, `claims_total`, `supported`/`partial`/`unsupported`, `by_section`, `checked_at`, `stale`) are identical across T1 (producer), T2/T4 (read), and T6 (TS `QualityReport`). `version_kind` ∈ `('artifact','topic')` consistent in migration, repo, task, endpoints. `cited_content_hash` produced in T4's `tasks.py` helper and consumed in the read stub + repo. `runGroundingCheck` path matches the T4 endpoint route.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-08-17-grounding-readability-quality-report.md`. Order T1→T2→T3→T4→T5→T6 (T2 finishes its grounding stub in T4; T5 is independent and may interleave).
