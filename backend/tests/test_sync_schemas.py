"""Direct tests for the sync wire-schema byte boundary (base64<->bytes).

Pure functions — no DB, no app, no network — so unlike the repo/router tests
these always run regardless of `DATABASE_URL`. `_b64e`/`_b64d` are the ONLY
place `src/sync` touches raw bytes vs. the wire's base64 strings; everything
else treats ciphertext as opaque.
"""

from __future__ import annotations

import base64
import binascii

import pytest

from src.sync import schemas


def test_b64_roundtrip():
    raw = bytes(range(256))
    assert schemas._b64d(schemas._b64e(raw)) == raw


def test_b64e_matches_stdlib_base64():
    assert schemas._b64e(b"hello world") == base64.b64encode(b"hello world").decode("ascii")


def test_b64d_rejects_invalid_base64():
    with pytest.raises(binascii.Error):
        schemas._b64d("not-valid-base64!!!")


def test_keyset_in_decoded_roundtrip():
    k = schemas.KeysetIn(
        wrapped_lmk=schemas._b64e(b"lmk-bytes"),
        lmk_nonce=schemas._b64e(b"lmk-nonce-bytes"),
        kek_salt=schemas._b64e(b"kek-salt-bytes"),
    )
    wrapped_lmk, lmk_nonce, kek_salt = k.decoded()
    assert wrapped_lmk == b"lmk-bytes"
    assert lmk_nonce == b"lmk-nonce-bytes"
    assert kek_salt == b"kek-salt-bytes"
    assert k.force is False  # default


def test_book_blob_in_decoded_roundtrip():
    b = schemas.BookBlobIn(
        ciphertext=schemas._b64e(b"cipher-bytes"),
        nonce=schemas._b64e(b"nonce-bytes"),
        wrapped_dk=schemas._b64e(b"wrapped-dk-bytes"),
        dk_nonce=schemas._b64e(b"dk-nonce-bytes"),
        client_version="v1",
    )
    ciphertext, nonce, wrapped_dk, dk_nonce = b.decoded()
    assert ciphertext == b"cipher-bytes"
    assert nonce == b"nonce-bytes"
    assert wrapped_dk == b"wrapped-dk-bytes"
    assert dk_nonce == b"dk-nonce-bytes"


def test_keyset_out_from_repo_encodes():
    class _Row:
        wrapped_lmk = b"lmk-bytes"
        lmk_nonce = b"nonce-bytes"
        kek_salt = b"salt-bytes"
        created_at = None

    out = schemas.KeysetOut.from_repo(_Row())
    assert out.wrapped_lmk == schemas._b64e(b"lmk-bytes")
    assert out.lmk_nonce == schemas._b64e(b"nonce-bytes")
    assert out.kek_salt == schemas._b64e(b"salt-bytes")


def test_book_out_from_repo_encodes_ciphertext_and_keeps_metadata():
    class _Row:
        book_id = "b1"
        ciphertext = b"cipher-bytes"
        nonce = b"nonce-bytes"
        wrapped_dk = b"wdk-bytes"
        dk_nonce = b"dkn-bytes"
        client_version = "v1"
        deleted = False
        updated_at = None

    out = schemas.BookOut.from_repo(_Row())
    assert out.ciphertext == schemas._b64e(b"cipher-bytes")
    assert out.book_id == "b1"
    assert out.client_version == "v1"
    assert out.deleted is False
