"""Publish metadata gate for the Author Commons.

A book may only be published when it carries a title, an author and the
publishing account's name. Empty or whitespace-only values count as missing.
"""

from __future__ import annotations


def _blank(value: object) -> bool:
    return not isinstance(value, str) or not value.strip()


def missing_publish_fields(raw_book: dict, account_name: str | None) -> list[str]:
    """Names of the required publish fields that are missing, in a stable order.

    `account_name` is supplied by the caller (it is not part of the book).
    """
    metadata = raw_book.get("metadata")
    author = metadata.get("author") if isinstance(metadata, dict) else None
    missing: list[str] = []
    if _blank(raw_book.get("title")):
        missing.append("title")
    if _blank(author):
        missing.append("author")
    if _blank(account_name):
        missing.append("account_name")
    return missing
