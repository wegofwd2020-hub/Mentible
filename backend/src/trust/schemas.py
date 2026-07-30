from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MembershipOut(BaseModel):
    project_id: str
    role: str


class SessionSyncOut(BaseModel):
    account_id: str
    email: str | None
    memberships: list[MembershipOut]


class ProjectCreateIn(BaseModel):
    title: str
    topic: str | None = None
    audience: str | None = None
    goal: str | None = None


class ProjectOut(BaseModel):
    id: str
    title: str
    topic: str | None
    audience: str | None
    goal: str | None
    status: str
    created_at: datetime | None


class ProjectSummaryOut(BaseModel):
    id: str
    title: str
    status: str
    created_at: datetime | None


class ArtifactCreateIn(BaseModel):
    role: str
    format: str
    title: str | None = None


class ArtifactOut(BaseModel):
    id: str
    project_id: str
    role: str
    format: str
    title: str | None
    created_at: datetime | None


class VersionCreateIn(BaseModel):
    content: dict
    generation_meta: dict | None = None


class VersionOut(BaseModel):
    id: str
    artifact_id: str
    version_no: int
    created_at: datetime | None


class VersionSummaryOut(BaseModel):
    id: str
    version_no: int
    created_at: datetime | None
    is_validated: bool
    recorded_via: str | None = None


class ArtifactDetailOut(BaseModel):
    artifact: ArtifactOut
    versions: list[VersionSummaryOut]


InputKind = Literal["transcript", "note", "link"]


class ProjectInputIn(BaseModel):
    kind: InputKind
    title: str | None = Field(default=None, max_length=200)
    content: str = Field(min_length=1, max_length=200_000)
    source_ref: str | None = Field(default=None, max_length=500)


class ProjectInputOut(BaseModel):
    id: str
    kind: str
    title: str | None
    content: str
    source_ref: str | None
    created_at: datetime | None


class ProjectDetailOut(BaseModel):
    project: ProjectOut
    artifacts: list[ArtifactDetailOut]
    my_role: str
    inputs: list[ProjectInputOut]


class InviteIn(BaseModel):
    email: str


class InvitationOut(BaseModel):
    project_id: str
    invited_email: str
    role: str
    revoked_at: datetime | None


class ApprovalIn(BaseModel):
    approved_at: datetime
    note: str | None = None
    expert_name: str | None = None
    expert_email: str | None = None
    expert_role: str | None = None


class ApprovalOut(BaseModel):
    id: str
    version_id: str
    expert_name: str
    approved_at: datetime
    recorded_via: str
