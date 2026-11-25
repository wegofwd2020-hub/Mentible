"""Author Commons catalog endpoints: listing, detail (metadata only) and owner hide.

No router prefix: every route spells its full path (more routes share this module).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal
from backend.src.library import commons_repo

router = APIRouter(tags=["author-commons"])

PAGE_SIZE = 20


class CommonsSummary(BaseModel):
    book_id: str
    title: str
    author_name: str
    account_name: str
    version: int
    published_at: datetime
    formats: list[str]
    language: str | None
    cover_svg: str | None


class CommonsDetail(CommonsSummary):
    description: str | None


class CommonsListResponse(BaseModel):
    items: list[CommonsSummary]
    total: int
    page: int
    page_size: int


def _summary(e: commons_repo.CommonsEntry) -> CommonsSummary:
    return CommonsSummary(
        book_id=e.book_id,
        title=e.title,
        author_name=e.author_name,
        account_name=e.account_name,
        version=e.version,
        published_at=e.published_at,
        formats=e.formats,
        language=e.language,
        cover_svg=e.cover_svg,
    )


def _pool(request: Request):
    pool = getattr(request.app.state, "db", None)
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="the Author Commons is not available",
        )
    return pool


@router.get("/api/v1/author-commons", response_model=CommonsListResponse)
async def list_commons(
    request: Request,
    query: str = "",
    language: str | None = None,
    page: int = Query(1, ge=1),
    _principal: Principal = Depends(require_user),
) -> CommonsListResponse:
    async with _pool(request).acquire() as conn:
        entries, total = await commons_repo.list_live(
            conn,
            query=query,
            language=language or None,
            limit=PAGE_SIZE,
            offset=(page - 1) * PAGE_SIZE,
        )
    return CommonsListResponse(
        items=[_summary(e) for e in entries], total=total, page=page, page_size=PAGE_SIZE
    )


@router.get("/api/v1/author-commons/{book_id}", response_model=CommonsDetail)
async def get_commons_entry(
    book_id: str,
    request: Request,
    _principal: Principal = Depends(require_user),
) -> CommonsDetail:
    async with _pool(request).acquire() as conn:
        entry = await commons_repo.get_entry(conn, book_id)
    if entry is None or entry.status != "live":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    return CommonsDetail(**_summary(entry).model_dump(), description=entry.description)


@router.post("/api/v1/library/{book_id}/hide")
async def hide_commons_entry(
    book_id: str,
    request: Request,
    principal: Principal = Depends(require_user),
) -> dict[str, str]:
    """Owner-only: take a book out of the commons. Keeps the project and every
    stored file; republishing makes it live again."""
    async with _pool(request).acquire() as conn:
        entry = await commons_repo.get_entry(conn, book_id)
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
        if entry.owner_sub != principal.sub:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not the owner")
        await commons_repo.set_status(conn, book_id=book_id, status="hidden")
    return {"status": "hidden"}
