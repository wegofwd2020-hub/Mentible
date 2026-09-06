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
