from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

PROJECT_STATUSES = ("active", "archived")
INPUT_KINDS = ("transcript", "note", "upload", "link")
ARTIFACT_ROLES = ("cornerstone", "derivative")
ARTIFACT_FORMATS = (
    "book",
    "guide",
    "learning_module",
    "podcast",
    "youtube",
    "reel",
    "linkedin",
    "x_thread",
    "essay",
)
FEEDBACK_AUTHOR_KINDS = ("expert", "operator")
MEMBERSHIP_ROLES = ("owner", "reviewer")
INVITE_ROLES = ("reviewer",)
APPROVAL_VIA = ("operator", "expert_self")
# Append-only toggle: 'approve' records validation, 'withdraw' revokes it. A
# version is validated IFF its latest approval row is an 'approve' (ADR-037 —
# trust evidence stays immutable; withdrawing appends, never deletes).
APPROVAL_ACTION = ("approve", "withdraw")


@dataclass(frozen=True)
class Project:
    id: str
    owner_account_id: str
    title: str
    topic: str | None
    audience: str | None
    goal: str | None
    status: str
    created_at: datetime | None
    updated_at: datetime | None


@dataclass(frozen=True)
class ProjectInput:
    id: str
    project_id: str
    kind: str
    title: str | None
    content: str | None
    source_ref: str | None
    storage_path: str | None
    content_hash: str | None
    created_at: datetime | None


@dataclass(frozen=True)
class Artifact:
    id: str
    project_id: str
    role: str
    format: str
    title: str | None
    created_at: datetime | None
    updated_at: datetime | None


@dataclass(frozen=True)
class ArtifactVersion:
    id: str
    artifact_id: str
    version_no: int
    content: object  # parsed jsonb
    generation_meta: object | None
    created_by_sub: str
    created_at: datetime | None


@dataclass(frozen=True)
class Feedback:
    id: str
    version_id: str
    author_kind: str
    author_name: str | None
    body: str
    recorded_by_sub: str
    created_at: datetime | None


@dataclass(frozen=True)
class Approval:
    id: str
    version_id: str
    expert_name: str
    expert_email: str | None
    expert_role: str | None
    approved_at: datetime
    recorded_by_sub: str
    recorded_at: datetime | None
    note: str | None
    recorded_via: str
    action: str


@dataclass(frozen=True)
class Membership:
    project_id: str
    account_id: str
    role: str
    created_at: datetime | None


@dataclass(frozen=True)
class Invitation:
    id: str
    project_id: str
    invited_email: str
    role: str
    invited_by_sub: str
    created_at: datetime | None
    revoked_at: datetime | None
