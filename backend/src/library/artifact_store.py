"""Durable on-disk store for PUBLISHED Open-Library artifacts (ADR-027).

Distinct from the ephemeral Redis export cache: these files persist so a reader
can download a published book any time. One file per (book, format) under
`settings.artifact_store_dir/<book_id>/<format>.<ext>`. In prod the dir must be a
mounted volume, or a redeploy orphans the registry rows.
"""

from __future__ import annotations

import hashlib
import os
import re

from backend.config import settings

_EXT = {"epub": "epub", "pdf": "pdf"}


def content_hash(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _safe(component: str) -> str:
    # book ids are uuids/slugs, but never trust them into a path.
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", component)[:120] or "book"


def artifact_path(book_id: str, fmt: str) -> str:
    ext = _EXT.get(fmt, "bin")
    return os.path.join(settings.artifact_store_dir, _safe(book_id), f"{fmt}.{ext}")


def store_artifact(book_id: str, fmt: str, data: bytes) -> str:
    """Write the artifact to disk (replacing any prior one) and return its path."""
    path = artifact_path(book_id, fmt)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # Write to a temp file then rename, so a reader never sees a half-written file.
    tmp = f"{path}.tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    return path


def read_artifact(path: str) -> bytes | None:
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None
