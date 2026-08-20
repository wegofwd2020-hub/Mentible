"""Wire schemas for the zero-knowledge sync API (ADR-014 increment 1).

Every payload field that carries key/content material is ciphertext, base64
encoded at this boundary — pydantic never sees plaintext and the server never
decodes it into anything meaningful. `_b64e`/`_b64d` are the ONLY places this
module touches the bytes; everywhere else it's an opaque base64 string.
"""

from __future__ import annotations

import base64
from datetime import datetime
from typing import Any

from pydantic import BaseModel


def _b64e(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _b64d(s: str) -> bytes:
    return base64.b64decode(s, validate=True)


class KeysetIn(BaseModel):
    """The caller's wrapped local-master-key envelope — opaque ciphertext to
    the server (ADR-014 zero-knowledge). `force=True` permits an explicit
    overwrite of an existing keyset (e.g. a deliberate passphrase reset); the
    default refuses a silent clobber (409)."""

    wrapped_lmk: str
    lmk_nonce: str
    kek_salt: str
    force: bool = False

    def decoded(self) -> tuple[bytes, bytes, bytes]:
        return _b64d(self.wrapped_lmk), _b64d(self.lmk_nonce), _b64d(self.kek_salt)


class KeysetOut(BaseModel):
    wrapped_lmk: str
    lmk_nonce: str
    kek_salt: str
    created_at: datetime | None

    @classmethod
    def from_repo(cls, k: Any) -> KeysetOut:
        return cls(
            wrapped_lmk=_b64e(k.wrapped_lmk),
            lmk_nonce=_b64e(k.lmk_nonce),
            kek_salt=_b64e(k.kek_salt),
            created_at=k.created_at,
        )


class BookBlobIn(BaseModel):
    """One synced book's ciphertext + wrapped per-book data key — opaque to
    the server (zero-knowledge). `client_version` is caller-supplied and
    never interpreted server-side (future conflict detection lives on the
    client)."""

    ciphertext: str
    nonce: str
    wrapped_dk: str
    dk_nonce: str
    client_version: str

    def decoded(self) -> tuple[bytes, bytes, bytes, bytes]:
        return (
            _b64d(self.ciphertext),
            _b64d(self.nonce),
            _b64d(self.wrapped_dk),
            _b64d(self.dk_nonce),
        )


class BookOut(BaseModel):
    book_id: str
    ciphertext: str
    nonce: str
    wrapped_dk: str
    dk_nonce: str
    client_version: str
    deleted: bool
    updated_at: datetime | None

    @classmethod
    def from_repo(cls, b: Any) -> BookOut:
        return cls(
            book_id=b.book_id,
            ciphertext=_b64e(b.ciphertext),
            nonce=_b64e(b.nonce),
            wrapped_dk=_b64e(b.wrapped_dk),
            dk_nonce=_b64e(b.dk_nonce),
            client_version=b.client_version,
            deleted=b.deleted,
            updated_at=b.updated_at,
        )


class BookMetaOut(BaseModel):
    """List-view row — metadata only, never the ciphertext (keeps `GET
    /sync/books` cheap and keeps a bulk listing from becoming a bulk blob
    dump)."""

    book_id: str
    client_version: str
    deleted: bool
    updated_at: datetime | None

    @classmethod
    def from_repo(cls, m: Any) -> BookMetaOut:
        return cls(
            book_id=m.book_id,
            client_version=m.client_version,
            deleted=m.deleted,
            updated_at=m.updated_at,
        )
