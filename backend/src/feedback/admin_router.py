from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.src.admin import audit
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
_EXPORT_CAP = 5000


def _payload(r: asyncpg.Record) -> dict:
    """Decode the jsonb `payload` column. asyncpg returns jsonb as a raw JSON
    STRING, not a dict — this must be json.loads'd, never treated as a dict
    directly (a silent `(r["payload"] or {}).get(...)` on the raw string would
    just return {} and drop the text)."""
    return json.loads(r["payload"]) if isinstance(r["payload"], str) else (r["payload"] or {})


def _csv_safe(v):
    """Neutralize CSV formula injection: a cell starting with a formula
    trigger is prefixed with a single quote so a spreadsheet treats it as text."""
    if isinstance(v, str) and v and v[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def _row(r: asyncpg.Record) -> FeedbackAdminRow:
    p = _payload(r)
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
    """Filtered export, capped at 5000 rows, no pagination. Audited — this is
    data egress."""
    rows = await repo.query_feedback(
        conn, type_=type, contact_preference=contact_preference, page=page, app=app,
        q=q, created_from=created_from, created_to=created_to, limit=_EXPORT_CAP, cursor=None,
    )
    await audit.record(
        conn, actor_sub=viewer.sub, actor_email=viewer.email,
        action="feedback.export", target_sub=None,
    )
    records = [
        _row(r).model_dump() | {"text": str(_payload(r).get("text", ""))} for r in rows
    ]
    if format == "json":
        return Response(
            content=json.dumps(records, indent=2), media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="feedback.json"'},
        )
    buf = io.StringIO()
    cols = ["created_at", "name", "email", "app", "page", "type", "contact_preference",
            "company", "role", "text"]
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for rec in records:
        w.writerow({k: _csv_safe(v) for k, v in rec.items()})
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="feedback.csv"'},
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
    p = _payload(r)
    base = _row(r)
    return FeedbackAdminDetail(**base.model_dump(), text=str(p.get("text", "")), payload=p)
