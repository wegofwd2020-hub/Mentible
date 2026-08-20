"""Zero-knowledge library sync API (ADR-014 increment 1).

Every route is `require_active_user`-gated, then resolves the account via
`accounts_repo.get_account(idp_sub)` — never trusts a client-supplied id
(app-level isolation, CLAUDE.md rule 4). Every payload is opaque ciphertext:
this module never decodes anything into a plaintext book or key, only
base64<->bytes at the wire boundary (see `schemas.py`). Logging is
metadata-only (book_id, byte counts, force flags) — never ciphertext/keys.
"""

from __future__ import annotations

import binascii

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response, status

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


async def _account(conn: asyncpg.Connection, principal: Principal) -> Account:
    account = await accounts_repo.get_account(conn, idp_sub=principal.sub)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    return account


def _guard_b64_size(raw_b64: str, *, max_b64_chars: int, field: str) -> None:
    if len(raw_b64) > max_b64_chars:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"{field} too large")


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
