# Slice A follow-up — Soften the cited-source guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the cited-source guard from deadlocking — block editing/deleting a source ONLY when a citing draft version is currently **validated** (approved), with an actionable message; allow when a source is cited only by unvalidated drafts.

**Architecture:** Replace the backend `input_cited` (cited-at-all) with `input_cited_by_validated` (cited by a version whose latest approval is an approve), reuse it at the two guard call sites, and make the 409 messages actionable (point at Unapprove). Backend-only.

**Tech Stack:** FastAPI · asyncpg · pytest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-slice-a-followup-cited-guard-softening-design.md`.
- "Validated" = the version's **latest** `approval.action == "approve"` (the slice-2 toggle) — the SAME rule `GET /projects/{id}` uses for `is_validated` (`router.py:280` `ap is not None and ap.action == "approve"`). A version whose latest approval is a `withdraw` is NOT validated.
- Guard granularity unchanged otherwise: `PATCH` blocks only when `body.content is not None` AND cited-by-validated; **title/source_ref edits always allowed**; `DELETE` blocked only when cited-by-validated.
- Owner-only + 404 behaviour unchanged.
- Backend-only: no migration, no new route (the optional citations endpoint/pre-confirm from the spec is DEFERRED — do NOT build it here).
- `ruff check backend/ pipeline/` and `ruff format --check backend/ pipeline/` MUST pass before commit (CI Backend Lint gate — this repo has tripped on it; run ruff, don't hand-format).

**Local backend test recipe (DB migrated to 0013):**
```bash
cd backend
export DATABASE_URL="postgresql://postgres:devlocal@localhost:5439/mentible_test"
export BYOK_MASTER_KEY="0000000000000000000000000000000000000000000000000000000000000000"
export SYSTEM_OWNER_SECRET="1111111111111111111111111111111111111111111111111111111111111111"
export REDIS_URL="redis://localhost:6379/0" APP_ENV=test LOG_LEVEL=INFO
export PYTHONPATH=/home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
source .venv/bin/activate
```
(If pg is stopped: `docker start mentible_local_pg`.)

---

### Task 1: Backend — cited-guard blocks only on a validated citing version

**Files:**
- Modify: `backend/src/trust/project_repo.py` (`input_cited` → `input_cited_by_validated`)
- Modify: `backend/src/trust/router.py` (two call sites + 409 messages)
- Test: `backend/tests/test_trust_router.py`

**Interfaces:**
- Produces: `project_repo.input_cited_by_validated(conn, *, project_id, input_id) -> bool` — true iff a version of the project cites the input AND that version's latest approval is an `approve`. Replaces `input_cited` (no other caller — verify with a grep).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_trust_router.py`. Helper to create a citing version + optionally approve it:

```python
def _cite_input_in_new_version(c, artifact_id, input_id):
    return c.post(
        f"/api/v1/trust/artifacts/{artifact_id}/versions",
        json={"content": {"sections": [{"heading": "H", "body": "B", "source_ids": [input_id]}]}},
    ).json()["id"]


def test_source_cited_only_by_unvalidated_draft_is_editable_and_deletable():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        pid, iid = _seed_project_with_input(c, owner)          # from the Slice A tests
        art = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                     json={"role": "cornerstone", "format": "book"}).json()
        _cite_input_in_new_version(c, art["id"], iid)           # cited, but NOT approved
        # content edit + delete now SUCCEED (only an unvalidated draft cites it)
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"content": "new"}).status_code == 200
        assert c.delete(f"/api/v1/trust/inputs/{iid}").status_code == 204


def test_source_cited_by_validated_version_is_blocked_then_unlocks_after_withdraw():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        pid, iid = _seed_project_with_input(c, owner)
        art = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                     json={"role": "cornerstone", "format": "book"}).json()
        vid = _cite_input_in_new_version(c, art["id"], iid)
        # approve the citing version (owner records on a named expert's behalf)
        c.post(f"/api/v1/trust/versions/{vid}/approvals",
               json={"approved_at": "2026-08-07T00:00:00Z", "expert_name": "Dr. X"})
        # now content edit + delete are BLOCKED; title still allowed
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"content": "x"}).status_code == 409
        assert c.delete(f"/api/v1/trust/inputs/{iid}").status_code == 409
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"title": "t"}).status_code == 200
        # WITHDRAW the approval → the source unlocks
        c.post(f"/api/v1/trust/versions/{vid}/approvals/withdraw",
               json={"approved_at": "2026-08-07T00:00:00Z", "expert_name": "Dr. X"})
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"content": "ok"}).status_code == 200
```

Note: match the exact approve / withdraw request bodies the existing approval tests in this file use — copy their JSON shape (expert_name / approved_at fields) verbatim; the snippet above is indicative. If a helper for approve already exists in the test file, reuse it.

- [ ] **Step 2: Run — verify they fail**

Run: `cd backend && python -m pytest tests/test_trust_router.py -k "cited_only_by_unvalidated or cited_by_validated_version" -v`
Expected: FAIL — the unvalidated case currently returns 409 (old `input_cited` blocks any citation).

- [ ] **Step 3: Replace the repo helper**

In `project_repo.py`, rename `input_cited` → `input_cited_by_validated` and add the "latest approval is approve" condition:

```python
async def input_cited_by_validated(conn, *, project_id, input_id) -> bool:
    return bool(
        await conn.fetchval(
            """
        SELECT EXISTS (
          SELECT 1 FROM artifact_version v JOIN artifact a ON a.id = v.artifact_id
          WHERE a.project_id = $1 AND v.content IS NOT NULL
            AND v.content -> 'sections' @> jsonb_build_array(
                  jsonb_build_object('source_ids', jsonb_build_array($2::text)))
            AND (SELECT ap.action FROM approval ap WHERE ap.version_id = v.id
                 ORDER BY ap.seq DESC LIMIT 1) = 'approve'
        )
        """,
            project_id,
            str(input_id),
        )
    )
```

- [ ] **Step 4: Update the two call sites + messages (`router.py`)**

At the PATCH site (currently `router.py:188`): call `input_cited_by_validated` and change the message to be actionable:
```python
    if body.content is not None and await project_repo.input_cited_by_validated(
        conn, project_id=project_id, input_id=input_id
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This source is cited by an approved draft — unapprove that draft first to edit the source.",
        )
```
At the DELETE site (currently `router.py:223`):
```python
    if await project_repo.input_cited_by_validated(
        conn, project_id=project_id, input_id=input_id
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This source is cited by an approved draft — unapprove that draft first to remove the source.",
        )
```
Grep to confirm `input_cited` has no remaining references anywhere before finishing.

- [ ] **Step 5: Run — verify pass + full trust suite**

Run: `cd backend && python -m pytest tests/test_trust_router.py -v`
Expected: PASS — the 2 new tests + all existing (the Slice A `test_cited_input_guards_...` test must be reconciled: its fixture cites an input from an **unapproved** version, so under the new rule that content-edit/delete now SUCCEEDS. **Update that Slice A test** to approve the citing version first if it means to assert the block — or split it. Note the change in your report; do not delete coverage).

- [ ] **Step 6: Lint**

Run: `cd backend && ruff check backend/ pipeline/ && ruff format --check backend/ pipeline/`
Expected: both clean. If not: `ruff check --fix backend/ pipeline/ && ruff format backend/ pipeline/`, then re-run the tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/trust/project_repo.py backend/src/trust/router.py backend/tests/test_trust_router.py
git commit -m "feat(trust): cited-source guard blocks only on an approved citing version (fix deadlock)"
```

---

## Final verification (after all tasks)

- [ ] `cd backend && python -m pytest tests/test_trust_router.py -v` — all pass; no-key gate green.
- [ ] `ruff check backend/ pipeline/ && ruff format --check backend/ pipeline/` — clean.
- [ ] PR body: **prod backend refresh on ship** (behaviour change; no migration, no new route). No web redeploy needed for the core fix (the 409 text comes from the backend); the mobile 409 handler already surfaces `ApiError.userMessage()`.

## Self-review

- **Spec coverage:** validated-only block (Step 3), actionable messages + Unapprove escape (Step 4), the unlock-after-withdraw path (Step 1 test). Deferred items (stale-marking, citations endpoint/pre-confirm) correctly excluded.
- **Type consistency:** `input_cited_by_validated(project_id, input_id)` used identically at both call sites; the "latest approval == approve" SQL mirrors the `is_validated` rule at `router.py:280`.
- **Placeholders:** none — the repo SQL + both message strings + the call-site edits are literal; the tests are concrete (indicative approve/withdraw bodies flagged to match the file's existing approval tests).
