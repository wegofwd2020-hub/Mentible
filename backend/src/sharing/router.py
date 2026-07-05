"""Draft-sharing HTTP surface (ADR-027 D2-D4). All endpoints require a user."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status

from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal
from backend.src.core.rate_limit import enforce_rate_limit
from backend.src.sharing import repo
from backend.src.sharing.schemas import (
    CommentIn,
    CommentOut,
    DraftOut,
    InvitationOut,
    InviteIn,
    OwnedReviewOut,
    ResponseIn,
    SharedItem,
    ShareIn,
)

router = APIRouter(prefix="/api/v1/drafts", tags=["drafts"])


def _pool(request: Request):
    pool = getattr(request.app.state, "db", None)
    if pool is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "draft sharing is not available")
    return pool


async def _require_owner(conn, book_id: str, p: Principal) -> None:
    if await repo.draft_access(conn, book_id=book_id, sub=p.sub, email=p.email) != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the draft owner")


async def _require_access(conn, book_id: str, p: Principal) -> str:
    access = await repo.draft_access(conn, book_id=book_id, sub=p.sub, email=p.email)
    if access is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this draft")
    return access


@router.post(
    "/{book_id}/share", response_model=DraftOut, dependencies=[Depends(enforce_rate_limit)]
)
async def share_draft(
    book_id: str, body: ShareIn, request: Request, p: Principal = Depends(require_user)
):
    async with _pool(request).acquire() as conn:
        if not await repo.claim_or_share(conn, book_id=book_id, sub=p.sub):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "this draft is owned by another author")
        await repo.upsert_draft(
            conn,
            book_id=book_id,
            owner_sub=p.sub,
            version=body.version,
            title=body.title,
            book_json=body.book_json,
        )
    return DraftOut(
        book_id=book_id,
        title=body.title,
        version=body.version,
        book_json=body.book_json,
        access="owner",
    )


@router.get("/shared-with-me", response_model=list[SharedItem])
async def shared_with_me(request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        items = await repo.shared_with_me(conn, email=p.email)
    return [SharedItem(**vars(i)) for i in items]


@router.get("/mine", response_model=list[OwnedReviewOut])
async def my_drafts(request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        rows = await repo.owned_drafts_with_comments(conn, owner_sub=p.sub)
    return [OwnedReviewOut(**vars(r)) for r in rows]


@router.get("/{book_id}", response_model=DraftOut)
async def get_draft(book_id: str, request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        access = await _require_access(conn, book_id, p)
        d = await repo.get_draft(conn, book_id=book_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "draft not found")
    return DraftOut(
        book_id=d.book_id, title=d.title, version=d.version, book_json=d.book_json, access=access
    )


@router.get("/{book_id}/invitations", response_model=list[InvitationOut])
async def list_invitations(book_id: str, request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        await _require_owner(conn, book_id, p)
        inv = await repo.list_invitations(conn, book_id=book_id)
    return [InvitationOut(**vars(i)) for i in inv]


@router.post("/{book_id}/invitations", dependencies=[Depends(enforce_rate_limit)])
async def add_invitation(
    book_id: str, body: InviteIn, request: Request, p: Principal = Depends(require_user)
):
    async with _pool(request).acquire() as conn:
        await _require_owner(conn, book_id, p)
        await repo.add_invitation(conn, book_id=book_id, email=body.email, invited_by_sub=p.sub)
    return {"ok": True}


@router.delete("/{book_id}/invitations")
async def revoke_invitation(
    book_id: str,
    request: Request,
    email: str = Body(..., embed=True),
    p: Principal = Depends(require_user),
):
    async with _pool(request).acquire() as conn:
        await _require_owner(conn, book_id, p)
        if not await repo.revoke_invitation(conn, book_id=book_id, email=email):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no active invitation for that email")
    return {"ok": True}


@router.get("/{book_id}/comments", response_model=list[CommentOut])
async def list_comments(
    book_id: str, version: str, request: Request, p: Principal = Depends(require_user)
):
    async with _pool(request).acquire() as conn:
        await _require_access(conn, book_id, p)
        rows = await repo.list_comments(conn, book_id=book_id, version=version)
    return [CommentOut(**vars(r)) for r in rows]


@router.post(
    "/{book_id}/comments", response_model=CommentOut, dependencies=[Depends(enforce_rate_limit)]
)
async def post_comment(
    book_id: str, body: CommentIn, request: Request, p: Principal = Depends(require_user)
):
    async with _pool(request).acquire() as conn:
        await _require_access(conn, book_id, p)
        c = await repo.add_comment(
            conn,
            book_id=book_id,
            version=body.version,
            author_sub=p.sub,
            author_email=p.email,
            body=body.body,
        )
    return CommentOut(**vars(c))


@router.put(
    "/{book_id}/comments/{comment_id}/response",
    response_model=CommentOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def set_response(
    book_id: str,
    comment_id: int,
    body: ResponseIn,
    request: Request,
    p: Principal = Depends(require_user),
):
    async with _pool(request).acquire() as conn:
        await _require_owner(conn, book_id, p)
        c = await repo.set_response(
            conn, book_id=book_id, comment_id=comment_id, response=body.response
        )
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found on this draft")
    return CommentOut(**vars(c))
