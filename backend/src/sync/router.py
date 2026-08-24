"""Zero-knowledge library sync API (ADR-014 increment 1).

Every route is `require_active_user`-gated, then resolves the account via
`accounts_repo.get_account(idp_sub)` — never trusts a client-supplied id
(app-level isolation, CLAUDE.md rule 4). Every payload is opaque ciphertext:
this module never decodes anything into a plaintext book or key, only
base64<->bytes at the wire boundary (see `schemas.py`). Logging is
metadata-only (book_id, byte counts, force flags) — never ciphertext/keys.
"""

from __future__ import annotations

import base64
import binascii

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ..accounts import repo as accounts_repo
from ..accounts.deps import require_active_user
from ..accounts.models import Account
from ..auth.principal import Principal
from ..core.log_redaction import get_logger
from ..core.rate_limit import enforce_rate_limit
from ..db.deps import get_conn
from . import repo, schemas

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])
log = get_logger("sync")

# 20MB ciphertext cap (fair-use / cost-control lever, D18) — checked against
# the base64-encoded length so an oversize payload 413s before we pay for a
# full decode. base64 of N bytes is exactly ceil(N/3)*4 chars.
_MAX_CIPHERTEXT_BYTES = 20 * 1024 * 1024
_MAX_CIPHERTEXT_B64_CHARS = ((_MAX_CIPHERTEXT_BYTES + 2) // 3) * 4

# The other bytea fields (wrapped keys, nonces, salt) are small by
# construction — an AES-GCM-wrapped key + nonce is tens of bytes. 4KB is a
# generous cap that still bounds unbounded storage on `wrapped_lmk` /
# `wrapped_dk` etc. from a malicious or buggy client.
_MAX_SMALL_FIELD_BYTES = 4 * 1024
_MAX_SMALL_FIELD_B64_CHARS = ((_MAX_SMALL_FIELD_BYTES + 2) // 3) * 4

# EPUBs are much larger than a book's rendered JSON — 50MB hard cap per file
# (increment 2, ADR-014). Enforced on the DECODED byte count since the epub
# payload is framed binary, not base64 JSON (see `put_epub`).
_MAX_EPUB_BYTES = 50 * 1024 * 1024
# Per-account total across all non-deleted epubs — a cost/storage lever, not
# a per-file guard. Distinct 413 detail string so the client can tell the two
# cases apart (retry-a-smaller-file vs. free-up-space).
_SOFT_CAP_BYTES = 500 * 1024 * 1024


async def _account(conn: asyncpg.Connection, principal: Principal) -> Account:
    # get_or_CREATE: a first-time signed-in user has no account row yet — provisioning
    # it here (idempotent on idp_sub) mirrors every other authenticated write path
    # (generate/export/derivatives/trust). Using get_account+404 here regressed
    # enable-sync for brand-new accounts ("Couldn't enable sync — 404").
    return await accounts_repo.get_or_create_account(
        conn, idp_sub=principal.sub, email=principal.email
    )


def _guard_b64_size(raw_b64: str, *, max_b64_chars: int, field: str) -> None:
    if len(raw_b64) > max_b64_chars:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"{field} too large")


def _b64_header(request: Request, name: str) -> bytes:
    """Decode one of the small fixed-size crypto-param headers on the epub
    routes (nonce / meta-nonce / wrapped key / tag). These are tiny by
    construction (an AES-GCM nonce/tag or a wrapped key is tens of bytes), so
    no separate size guard is needed before decoding. The (much larger) epub
    payload never travels as a header — it is the raw request/response body."""
    raw = request.headers.get(name)
    if raw is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"missing header {name}")
    try:
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid base64") from e


def _b64_header_capped(request: Request, name: str, *, max_b64_chars: int) -> bytes:
    """Like `_b64_header`, but for a header whose value is small in the
    common case yet not fixed-size by construction (the meta sidecar) — guard
    the base64 length before decoding so an oversize value 413s cheaply
    instead of ever landing in an unbounded header/column."""
    raw = request.headers.get(name)
    if raw is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"missing header {name}")
    _guard_b64_size(raw, max_b64_chars=max_b64_chars, field=name)
    try:
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid base64") from e


def _b64e(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


@router.get(
    "/keyset",
    response_model=schemas.KeysetOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def get_keyset(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.KeysetOut:
    account = await _account(conn, principal)
    k = await repo.get_keyset(conn, owner_account_id=account.id)
    if k is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no keyset for this account")
    return schemas.KeysetOut.from_repo(k)


@router.put(
    "/keyset",
    response_model=schemas.KeysetOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def put_keyset(
    body: schemas.KeysetIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.KeysetOut:
    account = await _account(conn, principal)
    for field, raw in (
        ("wrapped_lmk", body.wrapped_lmk),
        ("lmk_nonce", body.lmk_nonce),
        ("kek_salt", body.kek_salt),
    ):
        _guard_b64_size(raw, max_b64_chars=_MAX_SMALL_FIELD_B64_CHARS, field=field)
    try:
        wrapped_lmk, lmk_nonce, kek_salt = body.decoded()
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid base64") from e
    try:
        k = await repo.upsert_keyset(
            conn,
            owner_account_id=account.id,
            wrapped_lmk=wrapped_lmk,
            lmk_nonce=lmk_nonce,
            kek_salt=kek_salt,
            force=body.force,
        )
    except repo.KeysetExistsError as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "a keyset already exists for this account — pass force=true to overwrite",
        ) from e
    log.info("sync_keyset_put", force=body.force)
    return schemas.KeysetOut.from_repo(k)


@router.get(
    "/books",
    response_model=list[schemas.BookMetaOut],
    dependencies=[Depends(enforce_rate_limit)],
)
async def list_books(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[schemas.BookMetaOut]:
    account = await _account(conn, principal)
    books = await repo.list_books(conn, owner_account_id=account.id)
    return [schemas.BookMetaOut.from_repo(b) for b in books]


@router.get(
    "/books/{book_id}",
    response_model=schemas.BookOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def get_book(
    book_id: str,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.BookOut:
    account = await _account(conn, principal)
    b = await repo.get_book(conn, owner_account_id=account.id, book_id=book_id)
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "book not found")
    return schemas.BookOut.from_repo(b)


@router.put(
    "/books/{book_id}",
    response_model=schemas.BookOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def put_book(
    book_id: str,
    body: schemas.BookBlobIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.BookOut:
    account = await _account(conn, principal)
    _guard_b64_size(body.ciphertext, max_b64_chars=_MAX_CIPHERTEXT_B64_CHARS, field="ciphertext")
    for field, raw in (
        ("nonce", body.nonce),
        ("wrapped_dk", body.wrapped_dk),
        ("dk_nonce", body.dk_nonce),
    ):
        _guard_b64_size(raw, max_b64_chars=_MAX_SMALL_FIELD_B64_CHARS, field=field)
    try:
        ciphertext, nonce, wrapped_dk, dk_nonce = body.decoded()
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid base64") from e
    b = await repo.upsert_book(
        conn,
        owner_account_id=account.id,
        book_id=book_id,
        ciphertext=ciphertext,
        nonce=nonce,
        wrapped_dk=wrapped_dk,
        dk_nonce=dk_nonce,
        client_version=body.client_version,
    )
    log.info("sync_book_put", book_id=book_id, ciphertext_bytes=len(ciphertext))
    return schemas.BookOut.from_repo(b)


@router.delete(
    "/books/{book_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(enforce_rate_limit)],
)
async def delete_book(
    book_id: str,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    account = await _account(conn, principal)
    ok = await repo.tombstone_book(conn, owner_account_id=account.id, book_id=book_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "book not found")
    log.info("sync_book_deleted", book_id=book_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── synced_epub (ADR-014 increment 2, un-framed on the wire — Inc 2.1) ──────
#
# The epub payload (potentially tens of MB) travels as a RAW ciphertext-only
# octet-stream body — no framing. The native file cipher (Inc 2.1) returns
# the GCM tag separately from the ciphertext, so the tag and the (small,
# ~600KB-max) meta sidecar both travel as base64 headers alongside the other
# small, fixed-size crypto params (nonces, wrapped key) — never in the body.


@router.get(
    "/epubs",
    response_model=list[schemas.EpubMetaOut],
    dependencies=[Depends(enforce_rate_limit)],
)
async def list_epubs(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[schemas.EpubMetaOut]:
    account = await _account(conn, principal)
    epubs = await repo.list_epubs(conn, owner_account_id=account.id)
    return [schemas.EpubMetaOut.from_repo(e) for e in epubs]


@router.put(
    "/epubs/{epub_id}",
    response_model=schemas.EpubMetaOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def put_epub(
    epub_id: str,
    request: Request,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.EpubMetaOut:
    account = await _account(conn, principal)
    epub_ct = await request.body()  # raw ciphertext — no framing (Inc 2.1)

    nonce = _b64_header(request, "X-Nonce")
    tag = _b64_header(request, "X-Tag")
    wrapped_dk = _b64_header(request, "X-Wrapped-Dk")
    dk_nonce = _b64_header(request, "X-Dk-Nonce")
    meta_ct = _b64_header_capped(request, "X-Meta", max_b64_chars=_MAX_SMALL_FIELD_B64_CHARS)
    meta_nonce = _b64_header(request, "X-Meta-Nonce")
    client_version = request.headers.get("X-Client-Version")
    if client_version is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing header X-Client-Version")

    if len(epub_ct) > _MAX_EPUB_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "epub too large")

    # Lightweight lookup: just the prior byte_size, never the multi-MB
    # ciphertext/meta_ciphertext columns `get_epub` would pull back.
    existing_size = await repo.get_epub_byte_size(
        conn, owner_account_id=account.id, epub_id=epub_id
    )
    existing_bytes = existing_size if existing_size is not None else 0
    total = await repo.user_epub_total_bytes(conn, owner_account_id=account.id)
    if total - existing_bytes + len(epub_ct) > _SOFT_CAP_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "sync storage full")

    e = await repo.upsert_epub(
        conn,
        owner_account_id=account.id,
        epub_id=epub_id,
        ciphertext=epub_ct,
        nonce=nonce,
        meta_ciphertext=meta_ct,
        meta_nonce=meta_nonce,
        wrapped_dk=wrapped_dk,
        dk_nonce=dk_nonce,
        tag=tag,
        client_version=client_version,
        byte_size=len(epub_ct),
    )
    # Metadata only — never the body bytes or key material (CLAUDE.md rule 1 / ADR-001).
    log.info("sync_epub_put", epub_id=epub_id, byte_size=e.byte_size, client_version=client_version)
    return schemas.EpubMetaOut.from_repo(e)


@router.get(
    "/epubs/{epub_id}",
    dependencies=[Depends(enforce_rate_limit)],
)
async def get_epub(
    epub_id: str,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    account = await _account(conn, principal)
    e = await repo.get_epub(conn, owner_account_id=account.id, epub_id=epub_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "epub not found")
    if len(e.meta_ciphertext) > _MAX_SMALL_FIELD_BYTES:
        # A pre-2.1 backfilled row whose meta still carries a coverSvg (up to
        # ~600KB) — too big for the X-Meta header. Signal "re-push under 2.1"
        # rather than fail opaquely; a fresh Inc-2.1 push writes a tiny meta.
        raise HTTPException(status.HTTP_409_CONFLICT, "epub meta too large — re-sync required")
    # Crypto columns are NOT NULL (migrations 0025/0026) — always populated by
    # `upsert_epub`, so no defensive fallback is needed here.
    log.info("sync_epub_get", epub_id=epub_id, byte_size=e.byte_size)
    return Response(
        content=e.ciphertext,
        media_type="application/octet-stream",
        headers={
            "X-Nonce": _b64e(e.nonce),
            "X-Tag": _b64e(e.tag),
            "X-Wrapped-Dk": _b64e(e.wrapped_dk),
            "X-Dk-Nonce": _b64e(e.dk_nonce),
            "X-Meta": _b64e(e.meta_ciphertext),
            "X-Meta-Nonce": _b64e(e.meta_nonce),
            "X-Client-Version": e.client_version,
        },
    )


@router.delete(
    "/epubs/{epub_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(enforce_rate_limit)],
)
async def delete_epub(
    epub_id: str,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> Response:
    account = await _account(conn, principal)
    ok = await repo.tombstone_epub(conn, owner_account_id=account.id, epub_id=epub_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "epub not found")
    log.info("sync_epub_deleted", epub_id=epub_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── synced_shelves (ADR-014 increment 2) ────────────────────────────────────


@router.get(
    "/shelves",
    response_model=schemas.ShelvesOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def get_shelves(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ShelvesOut:
    account = await _account(conn, principal)
    s = await repo.get_shelves(conn, owner_account_id=account.id)
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no shelves for this account")
    return schemas.ShelvesOut.from_repo(s)


@router.put(
    "/shelves",
    response_model=schemas.ShelvesOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def put_shelves(
    body: schemas.ShelvesIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ShelvesOut:
    account = await _account(conn, principal)
    _guard_b64_size(body.ciphertext, max_b64_chars=_MAX_CIPHERTEXT_B64_CHARS, field="ciphertext")
    for field, raw in (
        ("nonce", body.nonce),
        ("wrapped_dk", body.wrapped_dk),
        ("dk_nonce", body.dk_nonce),
    ):
        _guard_b64_size(raw, max_b64_chars=_MAX_SMALL_FIELD_B64_CHARS, field=field)
    try:
        ciphertext, nonce, wrapped_dk, dk_nonce = body.decoded()
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid base64") from e
    s = await repo.upsert_shelves(
        conn,
        owner_account_id=account.id,
        ciphertext=ciphertext,
        nonce=nonce,
        wrapped_dk=wrapped_dk,
        dk_nonce=dk_nonce,
        client_version=body.client_version,
    )
    log.info("sync_shelves_put", ciphertext_bytes=len(ciphertext))
    return schemas.ShelvesOut.from_repo(s)
