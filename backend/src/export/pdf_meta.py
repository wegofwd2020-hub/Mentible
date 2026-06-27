"""Probe a compiled PDF's page geometry via `pdfinfo` (poppler-utils).

Used by the export-time compliance check (SBQ-TRUST-002) for the page-level
params A1 (page size) and A2 (page count). Key-free and deterministic, like the
rest of export.

HONEST MEASUREMENT: if `pdfinfo` is missing from the image, or the bytes are not
a PDF (e.g. an EPUB export), this returns `{}`. The caller treats a MISSING
measurement as a failing check, never a silent pass — see
`export/trust.compute_compliance`.
"""

from __future__ import annotations

import re
import shutil
import subprocess

from backend.src.core.log_redaction import get_logger

log = get_logger("export.pdf_meta")

# pdfinfo emits, among other lines:
#   Pages:           52
#   Page size:       595.276 x 841.89 pts (A4)
_PAGES_RE = re.compile(r"^Pages:\s+(\d+)\s*$", re.MULTILINE)
_PAGE_SIZE_RE = re.compile(r"^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts", re.MULTILINE)

_PDF_MAGIC = b"%PDF-"


def probe_pdf(artifact: bytes) -> dict:
    """Return `{page_size_pt: (w, h), content_pages: int}` from `pdfinfo`.

    Returns `{}` when the artifact is not a PDF or `pdfinfo` is unavailable —
    the artifact still exports; the affected page-level checks simply report a
    fail (a missing measurement is not a pass). Never raises.
    """
    if not artifact.startswith(_PDF_MAGIC):
        # An EPUB (or the cover PNG) — no page geometry to probe.
        return {}
    pdfinfo = shutil.which("pdfinfo")
    if pdfinfo is None:
        log.warning("pdfinfo_unavailable")
        return {}

    try:
        # Vetted call (S603): fixed argv — resolved absolute path + the literal
        # "-" stdin flag, no shell, no user-controlled arguments. The artifact
        # rides stdin as bytes, never the command line.
        proc = subprocess.run(  # noqa: S603
            [pdfinfo, "-"],  # resolved absolute path (no PATH lookup at call time)
            input=artifact,
            capture_output=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        log.warning("pdfinfo_failed")
        return {}

    if proc.returncode != 0:
        return {}

    out = proc.stdout.decode("utf-8", "replace")
    meta: dict = {}

    if m := _PAGES_RE.search(out):
        meta["content_pages"] = int(m.group(1))
    if m := _PAGE_SIZE_RE.search(out):
        # Round points to the nearest integer so the A4 comparison (595 × 842)
        # tolerates pdfinfo's fractional dims (595.276 × 841.89).
        meta["page_size_pt"] = (round(float(m.group(1))), round(float(m.group(2))))

    return meta
