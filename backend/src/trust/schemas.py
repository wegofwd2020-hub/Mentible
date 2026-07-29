from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


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


class ArtifactDetailOut(BaseModel):
    artifact: ArtifactOut
    versions: list[VersionSummaryOut]


class ProjectDetailOut(BaseModel):
    project: ProjectOut
    artifacts: list[ArtifactDetailOut]
    my_role: str


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
