from __future__ import annotations

import uuid

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from ..accounts import repo as accounts_repo
from ..accounts.deps import require_active_user
from ..accounts.models import Account
from ..auth.principal import Principal
from ..db.deps import get_conn
from . import approval_repo, artifact_repo, membership_repo, project_repo, schemas
from .access import ProjectAccessError, project_id_for_artifact, require_project_access

router = APIRouter(prefix="/api/v1/trust", tags=["trust"])


async def _account(conn: asyncpg.Connection, principal: Principal) -> Account:
    return await accounts_repo.get_or_create_account(
        conn, idp_sub=principal.sub, email=principal.email
    )


async def _require_role(
    conn: asyncpg.Connection, account: Account, project_id: uuid.UUID, *, need_owner: bool
) -> str:
    try:
        role = await require_project_access(conn, account_id=account.id, project_id=project_id)
    except ProjectAccessError as err:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this project") from err
    if need_owner and role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner only")
    return role


@router.post("/session/sync", response_model=schemas.SessionSyncOut)
async def session_sync(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.SessionSyncOut:
    async with conn.transaction():
        account = await _account(conn, principal)
        memberships = (
            await membership_repo.redeem_invitations_for(
                conn, account_id=account.id, email=principal.email
            )
            if principal.email
            else []
        )
    return schemas.SessionSyncOut(
        account_id=str(account.id),
        email=account.email,
        memberships=[
            schemas.MembershipOut(project_id=str(m.project_id), role=m.role) for m in memberships
        ],
    )


@router.post("/projects", response_model=schemas.ProjectOut)
async def create_project(
    body: schemas.ProjectCreateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectOut:
    account = await _account(conn, principal)
    p = await project_repo.create_project(
        conn,
        owner_account_id=account.id,
        title=body.title,
        topic=body.topic,
        audience=body.audience,
        goal=body.goal,
    )
    return schemas.ProjectOut(
        id=str(p.id),
        title=p.title,
        topic=p.topic,
        audience=p.audience,
        goal=p.goal,
        status=p.status,
        created_at=p.created_at,
    )


@router.post("/projects/{project_id}/artifacts", response_model=schemas.ArtifactOut)
async def create_artifact(
    project_id: uuid.UUID,
    body: schemas.ArtifactCreateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ArtifactOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
    try:
        a = await artifact_repo.create_artifact(
            conn,
            project_id=project_id,
            role=body.role,
            format=body.format,
            title=body.title,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    return schemas.ArtifactOut(
        id=str(a.id),
        project_id=str(a.project_id),
        role=a.role,
        format=a.format,
        title=a.title,
        created_at=a.created_at,
    )


@router.post("/artifacts/{artifact_id}/versions", response_model=schemas.VersionOut)
async def create_version(
    artifact_id: uuid.UUID,
    body: schemas.VersionCreateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.VersionOut:
    project_id = await project_id_for_artifact(conn, artifact_id=artifact_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
    v = await artifact_repo.create_version(
        conn,
        artifact_id=artifact_id,
        content=body.content,
        created_by_sub=principal.sub,
        generation_meta=body.generation_meta,
    )
    return schemas.VersionOut(
        id=str(v.id),
        artifact_id=str(v.artifact_id),
        version_no=v.version_no,
        created_at=v.created_at,
    )


@router.post("/projects/{project_id}/invitations", response_model=schemas.InvitationOut)
async def invite_expert(
    project_id: uuid.UUID,
    body: schemas.InviteIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.InvitationOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
    inv = await membership_repo.invite(
        conn,
        project_id=project_id,
        email=body.email,
        invited_by_sub=principal.sub,
    )
    return schemas.InvitationOut(
        project_id=str(inv.project_id),
        invited_email=inv.invited_email,
        role=inv.role,
        revoked_at=inv.revoked_at,
    )


@router.get("/projects/{project_id}", response_model=schemas.ProjectDetailOut)
async def get_project(
    project_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectDetailOut:
    account = await _account(conn, principal)
    role = await _require_role(conn, account, project_id, need_owner=False)
    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    artifacts = []
    for a in await artifact_repo.list_artifacts(conn, project_id=project_id):
        versions = []
        for v in await artifact_repo.list_versions(conn, artifact_id=a.id):
            validated = await approval_repo.is_validated(conn, version_id=v.id)
            versions.append(
                schemas.VersionSummaryOut(
                    id=str(v.id),
                    version_no=v.version_no,
                    created_at=v.created_at,
                    is_validated=validated,
                )
            )
        artifacts.append(
            schemas.ArtifactDetailOut(
                artifact=schemas.ArtifactOut(
                    id=str(a.id),
                    project_id=str(a.project_id),
                    role=a.role,
                    format=a.format,
                    title=a.title,
                    created_at=a.created_at,
                ),
                versions=versions,
            )
        )
    return schemas.ProjectDetailOut(
        project=schemas.ProjectOut(
            id=str(p.id),
            title=p.title,
            topic=p.topic,
            audience=p.audience,
            goal=p.goal,
            status=p.status,
            created_at=p.created_at,
        ),
        artifacts=artifacts,
        my_role=role,
    )
