"""Admin API schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field


class InterventionConfigResponse(BaseModel):
    """Current intervention config."""
    intervention_retry_interval_days: int = Field(ge=1, description="Days before retry")
    max_intervention_attempts: int = Field(ge=1, description="Max attempts")
    note: str


class InterventionConfigUpdateRequest(BaseModel):
    """Update intervention config (all fields optional)."""
    intervention_retry_interval_days: int | None = Field(default=None, ge=1, description="Days before retry")
    max_intervention_attempts: int | None = Field(default=None, ge=1, description="Max attempts")


class InterventionConfigUpdateResponse(BaseModel):
    """Response after updating intervention config."""
    message: str
    updated: dict[str, int]
    updated_by: str
