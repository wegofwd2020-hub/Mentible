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


# Hard caps on the free-text fields copied into the public catalog.
_LIMITS = (
    ("title", 300),
    ("author", 300),
    ("description", 5_000),
    ("coverSvg", 100_000),
)


def oversize_publish_fields(raw_book: dict) -> str | None:
    """A human-readable problem for the first field that is not a string or is
    over its cap, else None. Absent (None) optional fields are fine."""
    metadata = raw_book.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    sources = {
        "title": raw_book.get("title"),
        "author": metadata.get("author"),
        "description": metadata.get("description"),
        "coverSvg": metadata.get("coverSvg"),
    }
    for name, limit in _LIMITS:
        value = sources[name]
        if value is None:
            continue
        if not isinstance(value, str):
            return f"{name} must be a string"
        if len(value) > limit:
            return f"{name} is too long (max {limit} characters)"
    return None
