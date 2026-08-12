"""Pure TOC-lookup helpers.

Shared between the trust router's sync handlers (`_topic_status_rollup`, the
generate-submit endpoint) and the async per-topic generate Celery task
(`trust/tasks.py`). No DB access — these operate on the in-memory
`project.toc` JSON shape only, so they're safe to import from either side of
the FastAPI-process / Celery-worker-process boundary without creating an
import cycle between `router.py` and `tasks.py`.
"""

from __future__ import annotations


def find_toc_topic(toc: dict | None, topic_id: str) -> dict | None:
    for subj in (toc or {}).get("subjects", []):
        for unit in subj.get("units", []):
            if str(unit.get("id")) == topic_id:
                return unit
    return None
