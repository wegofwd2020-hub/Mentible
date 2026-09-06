# Feedback Admin Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give super-admins a screen in the existing admin console to view, filter, and export in-app feedback (the `app_feedback` rows from #529).

**Architecture:** A read-only admin sub-API `/api/v1/admin/feedback` (list + keyset pagination, detail, CSV/JSON export) over the existing `app_feedback` table, gated by a new `require_feedback_viewer` dependency that today delegates to `require_super_admin` (a seam so a wider `FEEDBACK_VIEWER_EMAILS` allowlist can be added later without touching endpoints). A web-first console screen `mobile/app/admin/feedback.tsx` renders a filter bar, a results table, a JSON-payload detail modal, and export buttons, via new `adminClient` methods. No schema/migration change — `app_feedback` already exists.

**Tech Stack:** FastAPI + asyncpg (backend), React Native + Expo + expo-router (mobile, web-first), pytest (DB-gated), Jest + RNTL.

**Spec:** none — bounded design agreed in conversation (2026-09-06). This plan's Global Constraints capture the agreed decisions.

## Global Constraints

- **Access = super-admin today, seam for later.** Add `require_feedback_viewer` in `backend/src/auth/deps.py`; its body today is `return require_super_admin(principal)`. EVERY feedback-admin endpoint depends on `require_feedback_viewer`, never `require_super_admin` directly. Non-viewer → 403 (inherited).
- **`type` and `contact_preference` live INSIDE the `payload` jsonb**, not as columns. Filter them via `payload->>'type'` / `payload->>'contact_preference'`. Only `name`, `email`, `app`, `page`, `created_at` are columns.
- **Keyset pagination**, not OFFSET: `ORDER BY created_at DESC, id DESC`, cursor is the last row's `(created_at, id)`, predicate `(created_at, id) < ($c_created, $c_id)`. Reuses `app_feedback_created_at_idx`.
- **Default view = last 30 days, newest first.** The mobile screen sends `from = now-30d` on first load; a "clear" removes it (all-time).
- **Export is capped and audited.** `/export` caps at 5000 rows and records ONE `admin_audit` row (action `feedback.export`) — it is data egress. Plain list/detail reads are NOT audited.
- **Enums reuse** `FeedbackType` / `ContactPreference` from `backend/src/feedback/schemas.py`. Ruff requires `StrEnum` (already the case).
- **Mobile:** import `Alert` from `@/lib/alert` (never RN's); use `useThemedStyles(makeStyles)` + `@/constants/theme` tokens; token via `useAuth().accessToken`; follow the `adminFetch` wrapper in `adminClient.ts`. Export download is web-first (`Blob` + anchor); native download is out of scope (button hidden on native).
- **DB-touching tests** are gated: `pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), ...)`, and use `asyncio.run(...)` (NOT `get_event_loop().run_until_complete`).
- **No Help topic** — admin surfaces are not in `FEATURES`, so the coverage gate does not apply.
- **No new migration** — `app_feedback` already exists (migration 0028).

---

### Task 1: Admin schemas + `require_feedback_viewer` seam

**Files:**
- Modify: `backend/src/feedback/schemas.py`
- Modify: `backend/src/auth/deps.py:98-107`
- Test: `backend/tests/test_feedback_admin_auth.py` (create)

**Interfaces:**
- Produces: `require_feedback_viewer(principal) -> Principal`; schemas `FeedbackAdminRow`, `FeedbackAdminList`, `FeedbackFilters` (used by Tasks 2-4).

- [ ] **Step 1: Add the viewer dependency** to `backend/src/auth/deps.py` after `require_super_admin`:

```python
def require_feedback_viewer(principal: Principal = Depends(require_super_admin)) -> Principal:
    """Gate for the feedback-admin surface. TODAY this is exactly super-admin.

    Seam (agreed 2026-09-06): when a non-admin feedback viewer is needed, widen
    this to also accept a `FEEDBACK_VIEWER_EMAILS` config allowlist — without
    touching any endpoint, since they all depend on THIS, not require_super_admin.
    """
    return principal
```

- [ ] **Step 2: Add admin schemas** to `backend/src/feedback/schemas.py` (append):

```python
class FeedbackAdminRow(BaseModel):
    id: str
    name: str
    email: str
    app: str
    page: str
    type: str | None
    contact_preference: str | None
    company: str | None
    role: str | None
    snippet: str          # first ~140 chars of text
    created_at: str


class FeedbackAdminDetail(FeedbackAdminRow):
    text: str             # full feedback text
    payload: dict         # the complete stored JSON


class FeedbackAdminList(BaseModel):
    rows: list[FeedbackAdminRow]
    next_cursor: str | None   # opaque; pass back as ?cursor= for the next page
```

- [ ] **Step 3: Write the auth test** `backend/tests/test_feedback_admin_auth.py`:

```python
from fastapi.testclient import TestClient
from backend.main import app
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal


def _as(is_admin: bool):
    app.dependency_overrides[require_user] = lambda: Principal(
        sub="u1", email="u@x.z", issuer="test", is_super_admin=is_admin
    )


def test_non_admin_forbidden_on_feedback_admin():
    with TestClient(app) as c:
        _as(False)
        assert c.get("/api/v1/admin/feedback").status_code == 403
    app.dependency_overrides.clear()
```

- [ ] **Step 4: Run** `cd backend && pytest tests/test_feedback_admin_auth.py -v`. Expected: FAIL (route not mounted yet — 404, not 403). This test goes green in Task 3; keep it.

- [ ] **Step 5: Commit** `git add backend/src/feedback/schemas.py backend/src/auth/deps.py backend/tests/test_feedback_admin_auth.py && git commit -m "feat(feedback-admin): viewer-gate seam + admin schemas"`

---

### Task 2: Repo — `query_feedback` + `get_feedback` (keyset, jsonb filters)

**Files:**
- Modify: `backend/src/feedback/repo.py`
- Test: `backend/tests/test_feedback_admin_repo.py` (create, DB-gated)

**Interfaces:**
- Consumes: nothing new.
- Produces: `query_feedback(conn, *, type_, contact_preference, page, app, q, created_from, created_to, limit, cursor) -> list[Record]`; `get_feedback(conn, id) -> Record | None`; `encode_cursor(record) -> str`; `decode_cursor(str) -> tuple[datetime, uuid.UUID]`.

- [ ] **Step 1: Write the failing DB test** `backend/tests/test_feedback_admin_repo.py`:

```python
import asyncio, os, uuid, json
import asyncpg, pytest

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")

from backend.src.feedback import repo


async def _seed(conn, *, type_, text, cp="feedback_only", app="mentible", page="/x"):
    payload = {"type": type_, "text": text, "contact_preference": cp}
    row = await conn.fetchrow(
        "INSERT INTO app_feedback (account_id, name, email, app, page, payload) "
        "VALUES (NULL,$1,$2,$3,$4,$5::jsonb) RETURNING id",
        "Jane", f"{uuid.uuid4()}@x.z", app, page, json.dumps(payload),
    )
    return row["id"]


def test_query_filters_and_keyset():
    async def _run():
        conn = await asyncpg.connect(DSN)
        try:
            b = await _seed(conn, type_="bug", text="upload broke")
            f = await _seed(conn, type_="feature", text="please add export")
            # type filter
            bugs = await repo.query_feedback(conn, type_="bug", limit=100)
            ids = {r["id"] for r in bugs}
            assert b in ids and f not in ids
            # free-text q
            hits = await repo.query_feedback(conn, q="export", limit=100)
            assert f in {r["id"] for r in hits}
            # keyset paging: page size 1 then cursor
            page1 = await repo.query_feedback(conn, limit=1)
            assert len(page1) == 1
            cur = repo.encode_cursor(page1[-1])
            page2 = await repo.query_feedback(conn, limit=1, cursor=cur)
            assert page2 and page2[0]["id"] != page1[0]["id"]
        finally:
            await conn.close()
    asyncio.run(_run())
```

- [ ] **Step 2: Run** `cd backend && pytest tests/test_feedback_admin_repo.py -v`. Expected: FAIL (`query_feedback` missing).

- [ ] **Step 3: Implement** in `backend/src/feedback/repo.py` (append; add imports `import base64`, `from datetime import datetime`):

```python
def encode_cursor(row: asyncpg.Record) -> str:
    raw = f"{row['created_at'].isoformat()}|{row['id']}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    created, id_ = raw.split("|", 1)
    return datetime.fromisoformat(created), uuid.UUID(id_)


async def query_feedback(
    conn: asyncpg.Connection,
    *,
    type_: str | None = None,
    contact_preference: str | None = None,
    page: str | None = None,
    app: str | None = None,
    q: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> list[asyncpg.Record]:
    """Filtered, keyset-paginated feedback, newest first. `type_` and
    `contact_preference` are read from the jsonb payload; the rest are columns."""
    clauses: list[str] = []
    args: list = []

    def bind(value) -> str:
        args.append(value)
        return f"${len(args)}"

    if type_ is not None:
        clauses.append(f"payload->>'type' = {bind(type_)}")
    if contact_preference is not None:
        clauses.append(f"payload->>'contact_preference' = {bind(contact_preference)}")
    if app is not None:
        clauses.append(f"app = {bind(app)}")
    if page is not None:
        clauses.append(f"page ILIKE {bind(f'%{page}%')}")
    if q is not None:
        p = bind(f"%{q}%")
        clauses.append(f"(name ILIKE {p} OR email ILIKE {p} OR payload->>'text' ILIKE {p})")
    if created_from is not None:
        clauses.append(f"created_at >= {bind(created_from)}")
    if created_to is not None:
        clauses.append(f"created_at <= {bind(created_to)}")
    if cursor is not None:
        c_created, c_id = decode_cursor(cursor)
        clauses.append(f"(created_at, id) < ({bind(c_created)}, {bind(c_id)})")

    sql = "SELECT id, name, email, app, page, payload, created_at FROM app_feedback"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += f" ORDER BY created_at DESC, id DESC LIMIT {bind(limit)}"
    return await conn.fetch(sql, *args)


async def get_feedback(conn: asyncpg.Connection, feedback_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow(
        "SELECT id, name, email, app, page, payload, created_at FROM app_feedback WHERE id = $1",
        feedback_id,
    )
```

- [ ] **Step 4: Run** `cd backend && pytest tests/test_feedback_admin_repo.py -v`. Expected: PASS (with DATABASE_URL) or SKIP (without). Also `ruff check backend/src/feedback/repo.py`.

- [ ] **Step 5: Commit** `git add backend/src/feedback/repo.py backend/tests/test_feedback_admin_repo.py && git commit -m "feat(feedback-admin): keyset query + get repo helpers"`

---

### Task 3: Admin router — list + detail, mounted

**Files:**
- Create: `backend/src/feedback/admin_router.py`
- Modify: `backend/main.py` (import + `include_router`)
- Test: `backend/tests/test_feedback_admin_api.py` (create, DB-gated) + Task 1's auth test now green.

**Interfaces:**
- Consumes: `query_feedback`, `get_feedback`, `encode_cursor` (Task 2); `FeedbackAdminRow/Detail/List`, `require_feedback_viewer` (Task 1).
- Produces: routes `GET /api/v1/admin/feedback`, `GET /api/v1/admin/feedback/{id}`.

- [ ] **Step 1: Create** `backend/src/feedback/admin_router.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.src.auth.deps import require_feedback_viewer
from backend.src.auth.principal import Principal
from backend.src.db.deps import get_conn
from backend.src.feedback import repo
from backend.src.feedback.schemas import (
    FeedbackAdminDetail,
    FeedbackAdminList,
    FeedbackAdminRow,
)

router = APIRouter(prefix="/api/v1/admin/feedback", tags=["admin", "feedback"])

_SNIPPET = 140


def _row(r: asyncpg.Record) -> FeedbackAdminRow:
    p = r["payload"] if isinstance(r["payload"], dict) else {}
    text = str(p.get("text", ""))
    return FeedbackAdminRow(
        id=str(r["id"]),
        name=r["name"],
        email=r["email"],
        app=r["app"],
        page=r["page"],
        type=p.get("type"),
        contact_preference=p.get("contact_preference"),
        company=p.get("company"),
        role=p.get("role"),
        snippet=text[:_SNIPPET],
        created_at=r["created_at"].isoformat(),
    )


@router.get("", response_model=FeedbackAdminList)
async def list_feedback(
    type: str | None = Query(default=None),
    contact_preference: str | None = Query(default=None),
    page: str | None = Query(default=None),
    app: str | None = Query(default=None),
    q: str | None = Query(default=None),
    created_from: datetime | None = Query(default=None),
    created_to: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None),
    _viewer: Principal = Depends(require_feedback_viewer),
    conn: asyncpg.Connection = Depends(get_conn),
) -> FeedbackAdminList:
    rows = await repo.query_feedback(
        conn, type_=type, contact_preference=contact_preference, page=page, app=app,
        q=q, created_from=created_from, created_to=created_to, limit=limit + 1, cursor=cursor,
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = repo.encode_cursor(rows[-1]) if has_more and rows else None
    return FeedbackAdminList(rows=[_row(r) for r in rows], next_cursor=next_cursor)


@router.get("/{feedback_id}", response_model=FeedbackAdminDetail)
async def get_one(
    feedback_id: uuid.UUID,
    _viewer: Principal = Depends(require_feedback_viewer),
    conn: asyncpg.Connection = Depends(get_conn),
) -> FeedbackAdminDetail:
    r = await repo.get_feedback(conn, feedback_id)
    if r is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such feedback")
    p = r["payload"] if isinstance(r["payload"], dict) else {}
    base = _row(r)
    return FeedbackAdminDetail(**base.model_dump(), text=str(p.get("text", "")), payload=p)
```

- [ ] **Step 2: Mount** in `backend/main.py`: add `from backend.src.feedback import admin_router as feedback_admin_router` beside the existing feedback import, and `app.include_router(feedback_admin_router.router)` beside the existing `app.include_router(feedback_router.router)`.

- [ ] **Step 3: Write the API test** `backend/tests/test_feedback_admin_api.py` (DB-gated; mirror `test_feedback_router.py` — override `require_active_user` to insert a submission, then override `require_user` as admin to read it):

```python
import os, uuid
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


def test_list_and_detail_roundtrip():
    with TestClient(app) as c:
        email = f"{uuid.uuid4()}@x.z"
        app.dependency_overrides[require_active_user] = lambda: Principal(
            sub=f"u-{uuid.uuid4()}", email=email, issuer="test", is_super_admin=False)
        from unittest.mock import patch
        with patch("backend.src.feedback.router.send_feedback_email"):
            r = c.post("/api/v1/feedback", json={
                "name": "Jane Q", "type": "bug", "text": "the upload button did nothing",
                "contact_preference": "schedule_call", "page": "/trust/abc"})
        assert r.status_code == 201, r.text
        fid = r.json()["id"]

        app.dependency_overrides[require_user] = lambda: Principal(
            sub="admin", email="a@x.z", issuer="test", is_super_admin=True)
        lst = c.get("/api/v1/admin/feedback?type=bug&q=upload")
        assert lst.status_code == 200, lst.text
        assert any(row["id"] == fid for row in lst.json()["rows"])
        det = c.get(f"/api/v1/admin/feedback/{fid}")
        assert det.status_code == 200
        body = det.json()
        assert body["text"] == "the upload button did nothing"
        assert body["payload"]["contact_preference"] == "schedule_call"
    app.dependency_overrides.clear()
```

- [ ] **Step 4: Run** `cd backend && pytest tests/test_feedback_admin_api.py tests/test_feedback_admin_auth.py -v`. Expected: auth test PASS (now 403, route exists); roundtrip PASS or SKIP. `ruff check backend/src/feedback/admin_router.py backend/main.py`.

- [ ] **Step 5: Commit** `git add backend/src/feedback/admin_router.py backend/main.py backend/tests/test_feedback_admin_api.py && git commit -m "feat(feedback-admin): list + detail endpoints"`

---

### Task 4: Export endpoint (CSV/JSON), audited

**Files:**
- Modify: `backend/src/feedback/admin_router.py`
- Test: `backend/tests/test_feedback_admin_export.py` (create, DB-gated)

**Interfaces:**
- Consumes: `query_feedback` (Task 2), `require_feedback_viewer`, `audit.record`.
- Produces: `GET /api/v1/admin/feedback/export`.

- [ ] **Step 1: Add** to `backend/src/feedback/admin_router.py` (imports: `import csv, io, json`; `from fastapi import Response`; `from backend.src.admin import audit`):

```python
_EXPORT_CAP = 5000


@router.get("/export")
async def export_feedback(
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    type: str | None = Query(default=None),
    contact_preference: str | None = Query(default=None),
    page: str | None = Query(default=None),
    app: str | None = Query(default=None),
    q: str | None = Query(default=None),
    created_from: datetime | None = Query(default=None),
    created_to: datetime | None = Query(default=None),
    viewer: Principal = Depends(require_feedback_viewer),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    """Filtered export, capped at 5000 rows. Audited — this is data egress."""
    rows = await repo.query_feedback(
        conn, type_=type, contact_preference=contact_preference, page=page, app=app,
        q=q, created_from=created_from, created_to=created_to, limit=_EXPORT_CAP, cursor=None,
    )
    await audit.record(
        conn, actor_sub=viewer.sub, actor_email=viewer.email,
        action="feedback.export", target_sub=None,
    )
    records = [_row(r).model_dump() | {"text": str((r["payload"] or {}).get("text", ""))} for r in rows]
    if format == "json":
        return Response(content=json.dumps(records, indent=2), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="feedback.json"'})
    buf = io.StringIO()
    cols = ["created_at", "name", "email", "app", "page", "type", "contact_preference",
            "company", "role", "text"]
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for rec in records:
        w.writerow(rec)
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="feedback.csv"'})
```

> NOTE: define `/export` — a static path — in the source ABOVE the `/{feedback_id}` route so FastAPI does not match "export" as an id. (If placed below, move it above during this task.)

- [ ] **Step 2: Write the test** `backend/tests/test_feedback_admin_export.py` (DB-gated; submit one row as in Task 3, then as admin GET `/export?format=csv` and `?format=json`):

```python
# ... same submit-as-user setup as Task 3 (factor a helper or inline) ...
def test_export_csv_and_json():
    with TestClient(app) as c:
        # (submit one feedback as a signed-in user — see Task 3 setup)
        # then:
        app.dependency_overrides[require_user] = lambda: Principal(
            sub="admin", email="a@x.z", issuer="test", is_super_admin=True)
        csv_r = c.get("/api/v1/admin/feedback/export?format=csv")
        assert csv_r.status_code == 200
        assert csv_r.headers["content-type"].startswith("text/csv")
        assert "created_at,name,email" in csv_r.text
        json_r = c.get("/api/v1/admin/feedback/export?format=json")
        assert json_r.status_code == 200
        assert isinstance(json_r.json(), list)
    app.dependency_overrides.clear()
```

- [ ] **Step 3: Run** `cd backend && pytest tests/test_feedback_admin_export.py -v` (PASS or SKIP). `ruff check backend/src/feedback/admin_router.py`.

- [ ] **Step 4: Commit** `git add backend/src/feedback/admin_router.py backend/tests/test_feedback_admin_export.py && git commit -m "feat(feedback-admin): audited CSV/JSON export"`

---

### Task 5: Mobile adminClient methods + types

**Files:**
- Modify: `mobile/src/api/adminClient.ts`
- Test: `mobile/__tests__/api/feedbackAdminClient.test.ts` (create)

**Interfaces:**
- Produces: `FeedbackRow`, `FeedbackDetail`, `FeedbackListResult`, `FeedbackFilters`; `listFeedback`, `getFeedback`, `feedbackExportUrl`.

- [ ] **Step 1: Write the failing test** `mobile/__tests__/api/feedbackAdminClient.test.ts`:

```typescript
import { listFeedback } from "@/api/adminClient";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => jest.clearAllMocks());

test("listFeedback builds the query string and returns rows", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true, status: 200,
    json: async () => ({ rows: [{ id: "1", name: "Jane" }], next_cursor: "c2" }),
  });
  const res = await listFeedback("tok", { type: "bug", q: "upload", limit: 25 });
  const url = mockFetch.mock.calls[0][0] as string;
  expect(url).toContain("/api/v1/admin/feedback?");
  expect(url).toContain("type=bug");
  expect(url).toContain("q=upload");
  expect(res.rows[0].name).toBe("Jane");
  expect(res.next_cursor).toBe("c2");
});
```

- [ ] **Step 2: Run** `cd mobile && npx jest __tests__/api/feedbackAdminClient.test.ts`. Expected: FAIL (`listFeedback` missing).

- [ ] **Step 3: Implement** — append to `mobile/src/api/adminClient.ts`:

```typescript
export interface FeedbackRow {
  id: string;
  name: string;
  email: string;
  app: string;
  page: string;
  type: string | null;
  contact_preference: string | null;
  company: string | null;
  role: string | null;
  snippet: string;
  created_at: string;
}

export interface FeedbackDetail extends FeedbackRow {
  text: string;
  payload: Record<string, unknown>;
}

export interface FeedbackListResult {
  rows: FeedbackRow[];
  next_cursor: string | null;
}

export interface FeedbackFilters {
  type?: string;
  contact_preference?: string;
  page?: string;
  app?: string;
  q?: string;
  created_from?: string; // ISO
  created_to?: string;
  limit?: number;
  cursor?: string;
}

function feedbackParams(f: FeedbackFilters): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v != null && v !== "") p.set(k, String(v));
  }
  return p;
}

export async function listFeedback(token: string, f: FeedbackFilters = {}): Promise<FeedbackListResult> {
  const qs = feedbackParams(f).toString();
  return (await adminFetch<FeedbackListResult>(`/feedback${qs ? `?${qs}` : ""}`, token)) as FeedbackListResult;
}

export async function getFeedback(token: string, id: string): Promise<FeedbackDetail> {
  return (await adminFetch<FeedbackDetail>(`/feedback/${encodeURIComponent(id)}`, token)) as FeedbackDetail;
}

// The export endpoint returns a file, not JSON — the screen fetches this URL with
// the Bearer token and triggers a browser download (web-first).
export function feedbackExportUrl(f: FeedbackFilters, format: "csv" | "json"): string {
  const p = feedbackParams({ ...f, limit: undefined, cursor: undefined });
  p.set("format", format);
  return `${resolveBaseUrl()}/api/v1/admin/feedback/export?${p.toString()}`;
}
```

- [ ] **Step 4: Run** `cd mobile && npx jest __tests__/api/feedbackAdminClient.test.ts && npx tsc --noEmit`. Expected: PASS + clean.

- [ ] **Step 5: Commit** `git add mobile/src/api/adminClient.ts mobile/__tests__/api/feedbackAdminClient.test.ts && git commit -m "feat(feedback-admin): mobile adminClient feedback methods"`

---

### Task 6: Console screen `admin/feedback.tsx` + home link

**Files:**
- Create: `mobile/app/admin/feedback.tsx`
- Modify: `mobile/app/admin.tsx` (add a link row, like the existing "Token usage" one)
- Test: `mobile/__tests__/app/adminFeedback.test.tsx` (create)

**Interfaces:**
- Consumes: `listFeedback`, `getFeedback`, `feedbackExportUrl`, types (Task 5); `useAuth`, `useAccount`, `useThemedStyles`, `PageContainer`, `Alert` from `@/lib/alert`.

- [ ] **Step 1: Add the home link** in `mobile/app/admin.tsx` — a second `Pressable` mirroring the "Token usage by user" row, pushing `/admin/feedback`, label "In-app feedback".

- [ ] **Step 2: Create** `mobile/app/admin/feedback.tsx` — a screen that:
  - Mirrors `admin.tsx`'s guard block (redirect non-admins; wait for `account`).
  - Holds `filters` state seeded to last-30-days: `{ created_from: new Date(Date.now() - 30*864e5).toISOString() }`.
  - Filter bar: a type `Dropdown`, a contact-preference `Dropdown`, a debounced search `TextInput` (binds `q`), and a "Clear" button that resets `filters` to `{}`. (Reuse the existing `Dropdown` component the FeedbackSheet uses — check `mobile/src/components/` for its import path.)
  - `load(reset)` calls `listFeedback(accessToken, { ...filters, limit: 50, cursor: reset ? undefined : cursor })`; appends rows; stores `next_cursor`. Reload on filter change and on focus (`useFocusEffect`).
  - `FlatList` of rows: each shows `created_at` (formatted), `email`, a type chip, `page`, and `snippet`; `onPress` opens a detail modal.
  - Detail modal: calls `getFeedback`, renders name/email/company/role/type/contact_preference/page/created_at and the full `text`, plus the raw `payload` in a monospace `<Text>` (JSON.stringify, indent 2) inside a `ScrollView`.
  - "Load more" footer button when `next_cursor != null`.
  - Export: two buttons (CSV, JSON). On web (`Platform.OS === "web"`): `fetch(feedbackExportUrl(filters, fmt), { headers: { Authorization: 'Bearer '+accessToken } })` → `res.blob()` → object URL → click a temporary `<a download>`; then revoke. On native: hide the export buttons (out of scope) — guard with `Platform.OS === "web"`.
  - All `Alert` from `@/lib/alert`; all styles via `useThemedStyles`.

- [ ] **Step 3: Write the screen test** `mobile/__tests__/app/adminFeedback.test.tsx` — mock `@/api/adminClient` (`listFeedback` returns two rows + `next_cursor: null`; `getFeedback` returns a detail), mock `@/auth/AuthProvider` (`status: "signed_in"`, `accessToken: "t"`) and `@/hooks/useAccount` (`{ account: { is_super_admin: true } }`); render, assert both rows' emails appear; tap a row and assert the detail text renders. Follow the mocking conventions in existing `mobile/__tests__/app/*` (and the jest.mock traps in memory: no TS param-properties, `mock`-prefixed vars only).

```typescript
// shape (fill in per existing __tests__/app conventions):
jest.mock("@/api/adminClient", () => ({
  listFeedback: jest.fn(async () => ({
    rows: [
      { id: "1", name: "A", email: "a@x.z", app: "mentible", page: "/p", type: "bug",
        contact_preference: "feedback_only", company: null, role: null, snippet: "hi", created_at: "2026-09-06T00:00:00Z" },
    ],
    next_cursor: null,
  })),
  getFeedback: jest.fn(async () => ({ id: "1", text: "full text here", payload: { type: "bug" } })),
  feedbackExportUrl: jest.fn(() => "http://x/export"),
}));
```

- [ ] **Step 4: Run** `cd mobile && npx jest __tests__/app/adminFeedback.test.tsx __tests__/api/feedbackAdminClient.test.ts && npx tsc --noEmit && npx eslint app/admin/feedback.tsx app/admin.tsx`. Expected: PASS + clean.

- [ ] **Step 5: Run the FULL mobile suite** `cd mobile && npx jest` (per the load-bearing lesson: mounting a screen can break an untouched guard test that targeted sweeps miss). Expected: green.

- [ ] **Step 6: Commit** `git add mobile/app/admin/feedback.tsx mobile/app/admin.tsx mobile/__tests__/app/adminFeedback.test.tsx && git commit -m "feat(feedback-admin): console feedback viewer screen + export"`

---

## Notes for the executor

- **No migration, no Help topic** (admin exempt from the coverage gate).
- **Backend DB tests** SKIP without `DATABASE_URL`; CI provides Postgres, so they run there — the real gate (per the STT/#529 lessons, single-process mocked tests miss DB-shape bugs).
- **Route order** matters in `admin_router.py`: the static `/export` route must be declared before `/{feedback_id}`.
- **`Dropdown` reuse**: find the component `FeedbackSheet.tsx` already uses and reuse it; do not write a second dropdown.
- Whole-branch review at the end should specifically check: the viewer-gate seam is the ONLY auth indirection (no endpoint calls `require_super_admin` directly), keyset cursor round-trips, and the export path is audited exactly once per call.
