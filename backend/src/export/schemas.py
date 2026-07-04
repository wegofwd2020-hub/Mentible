"""Response models for the async export job endpoints (POST /export/jobs)."""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel

ExportJobState = Literal["queued", "running", "done", "failed"]


class ExportSubmitResponse(BaseModel):
    job_id: uuid.UUID
    status: ExportJobState = "queued"


class ExportJobStatusResponse(BaseModel):
    job_id: uuid.UUID
    status: ExportJobState
    # Populated only when status == "failed" — a safe, client-facing message.
    error: str | None = None
    # Populated only when status == "done".
    title: str | None = None
    filename: str | None = None
    format: str | None = None
    size: int | None = None
    # Gate 3 format-drift warning count over the book (0 when clean).
    warnings: int | None = None
    # Base64 Content Trust Manifest (ADR-015 / SBQ-TRUST-002), when assembled.
    trust: str | None = None
