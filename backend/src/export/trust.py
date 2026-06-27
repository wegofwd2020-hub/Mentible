"""Book-level trust assembly at export (ADR-015, SBQ-TRUST-002).

Attaches the two post-compile blocks of a ContentTrustManifest — `compliance`
(the mechanically-checkable subset of `mentible-professional@1.0`) and
`integrity` (`content_hash`) — onto a base manifest carried from generation
(provenance + validation, stamped per-unit by SBQ-TRUST-001).

KEY-FREE, like the rest of export. The manifest is non-secret by construction
(wegofwd-llm's `to_public_dict()` is the boundary), so it ships in a response
header alongside the artifact.

HONEST COUNTING is the load-bearing rule (see the ticket):
  - A param that cannot be auto-checked yet is EXCLUDED from `checks_total` — not
    counted as a silent pass. The badge reads "N/N" because N ran.
  - `content_format_validator` drift warnings are ADVISORY: their presence caps
    the result at `pass_with_notes`, never a hard `fail`.
  - A MISSING page measurement (EPUB export, or `pdfinfo` absent) reports `fail`
    for the affected page-level check — a missing measurement is not a pass.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
from typing import Any

from wegofwd_llm.trust import (
    ComplianceBlock,
    ContentTrustManifest,
    IntegrityBlock,
    engine_trust,
)

from backend.src.core.format_scan import book_warnings
from backend.src.core.log_redaction import get_logger

log = get_logger("export.trust")

RULESET = "mentible-professional@1.0"

# A GFM table is recognised by its separator row (mirrors content_format_validator
# so "table" means the same thing here and in the drift check); a diagram is a
# fenced ```mermaid block (compiler/src/markdown.ts renders exactly those).
_TABLE_SEPARATOR_RE = re.compile(r"\|\s*:?-+:?\s*\|")
_MERMAID_FENCE_RE = re.compile(r"```\s*mermaid", re.IGNORECASE)

# A4 in PostScript points, rounded (pdfinfo reports 595.276 × 841.89).
_A4_PT = (595, 842)
# Content-page band for a ~50-page book (lower bound advisory, hard cap 55).
_PAGE_BAND = (45, 55)
# Visual-count band (figures + tables) for a standard book.
_VISUAL_BAND = (20, 30)


def content_hash(book: dict) -> str:
    """sha256 of the canonical book body — stable across key reorderings so two
    compiles of the same logical book hash identically."""
    canonical = json.dumps(book, sort_keys=True, separators=(",", ":")).encode()
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


# ── book.json readers (the same fields the manual A/B/C report measured) ───────


def _units(book: dict) -> list[dict]:
    content = book.get("content")
    if not isinstance(content, dict):
        return []
    return [u for u in content.values() if isinstance(u, dict)]


def _iter_markdown(value: Any) -> list[str]:
    """Collect every string leaf under a unit — lesson `body_markdown`, tutorial
    `content`, etc. — so visual counting doesn't depend on one content shape."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _iter_markdown(v)]
    if isinstance(value, list):
        return [s for v in value for s in _iter_markdown(v)]
    return []


def _count_visuals(book: dict) -> int:
    """Figures (```mermaid fences) + tables (GFM separators) across all units —
    the floats the compiler numbers (compiler/src/floats.ts)."""
    total = 0
    for unit in _units(book):
        for md in _iter_markdown(unit):
            total += len(_TABLE_SEPARATOR_RE.findall(md))
            total += len(_MERMAID_FENCE_RE.findall(md))
    return total


def _has_glossary(book: dict) -> bool:
    """B5: an end-of-book glossary (book.metadata.glossary, rendered as back
    matter by compiler/src/pdf.ts)."""
    glossary = (book.get("metadata") or {}).get("glossary")
    return isinstance(glossary, list) and len(glossary) > 0


# ── compliance + base manifest ─────────────────────────────────────────────────


def compute_compliance(book: dict, pdf_meta: dict) -> ComplianceBlock:
    """Run the auto-checkable `mentible-professional@1.0` params. `pdf_meta`
    carries `{page_size_pt, content_pages}` from `pdfinfo` (empty for an EPUB or
    when poppler is absent — the page-level checks then fail, never skip).

    Status is derived from the HARD checks only; the advisory content-drift check
    can downgrade a `pass` to `pass_with_notes` but, by design, never causes a
    hard `fail` (it is non-fatal, like the gate-3 warnings the X-Content-Warnings
    header already surfaces). The displayed `checks_passed/checks_total` count
    every check that ran, drift included, so the badge stays honest.
    """
    hard: list[bool] = []

    # A1 — page size is A4 (PDF only; empty pdf_meta ⇒ fail, not skip).
    hard.append(pdf_meta.get("page_size_pt") == _A4_PT)
    # A2 — content page count in band.
    hard.append(_PAGE_BAND[0] <= pdf_meta.get("content_pages", 0) <= _PAGE_BAND[1])
    # A3 — visual count in band (from book.json, format-agnostic).
    hard.append(_VISUAL_BAND[0] <= _count_visuals(book) <= _VISUAL_BAND[1])
    # B5 — glossary present (from book.json).
    hard.append(_has_glossary(book))

    # B2 (every chapter 3–5 pp) needs a chapter→page map that pdfinfo alone can't
    # produce. It is EXCLUDED from the count (honest counting) until the compiler
    # emits one — not vacuously passed nor unfairly failed. Activates the moment
    # pdf_meta carries `per_chapter_pages`.
    per_chapter = pdf_meta.get("per_chapter_pages")
    if isinstance(per_chapter, list) and per_chapter:
        hard.append(all(3 <= n <= 5 for n in per_chapter))

    # C-drift — ADVISORY. Counted for display, but kept out of the status floor.
    drift_clean = len(book_warnings(book)) == 0

    hard_passed = sum(hard)
    hard_total = len(hard)
    if hard_passed == hard_total:
        status = "pass"
    elif hard_passed >= hard_total - 2:
        status = "pass_with_notes"
    else:
        status = "fail"

    # A drift warning only SOFTENS a clean pass — it never turns a pass_with_notes
    # or a hard-check fail into something else.
    if not drift_clean and status == "pass":
        status = "pass_with_notes"

    return ComplianceBlock(
        ruleset=RULESET,
        checks_passed=hard_passed + (1 if drift_clean else 0),
        checks_total=hard_total + 1,
        status=status,
    )


def base_manifest(book: dict) -> ContentTrustManifest:
    """The provenance/validation the book carries from generation. Re-stamped
    from the book's pinned provider/model (generationParams) so model-verification
    stays single-sourced through the seam; `schema_validated` holds because every
    stored unit necessarily passed the generation-time schema gate (SBQ-TRUST-001).
    """
    gp = book.get("generationParams") or {}
    provider = gp.get("provider") or "anthropic"
    model = gp.get("model")  # None ⇒ the provider's registry default
    return engine_trust(provider, model, schema_validated=True, schema_id="book@1")


def attach_export_trust(
    base: ContentTrustManifest, book: dict, pdf_meta: dict, *, signed: bool = False
) -> ContentTrustManifest:
    """Attach compliance + integrity to a base (generation-time) manifest."""
    return dataclasses.replace(
        base,
        compliance=compute_compliance(book, pdf_meta),
        integrity=IntegrityBlock(content_hash=content_hash(book), signed=signed),
    )


def export_manifest(book: dict, artifact: bytes) -> ContentTrustManifest:
    """Assemble the full book-level manifest for a compiled artifact. Synchronous
    (it shells out to `pdfinfo`); the async router calls it via a thread."""
    # Imported here so a missing poppler binary can't break module import.
    from backend.src.export.pdf_meta import probe_pdf

    return attach_export_trust(base_manifest(book), book, probe_pdf(artifact))
