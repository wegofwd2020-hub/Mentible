from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException, status

from backend.config import settings

from ..accounts import repo as accounts_repo
from ..accounts.deps import require_active_user
from ..accounts.models import Account
from ..auth.principal import Principal
from ..billing import quota, usage_repo
from ..billing.access import is_pro, over_cap, resolve_managed_access
from ..core.byok_envelope import encrypt_api_key, parse_master_key
from ..core.log_redaction import get_logger
from ..core.rate_limit import enforce_rate_limit
from ..core.redis_dep import get_redis
from ..db.deps import get_conn
from ..generate.tasks import _byok_redis_key, _write_status
from . import (
    approval_repo,
    artifact_repo,
    book_gen,
    feedback_repo,
    generation_job_repo,
    membership_repo,
    project_repo,
    schemas,
    topic_approval_repo,
    topic_feedback_repo,
    topic_repo,
)
from .access import (
    ProjectAccessError,
    project_id_for_artifact,
    project_id_for_input,
    project_id_for_version,
    require_project_access,
)
from .tasks import generate_book_task, generate_topic_task, generate_version_task, suggest_toc_task
from .toc_util import find_toc_topic

router = APIRouter(prefix="/api/v1/trust", tags=["trust"])
log = get_logger("trust")


async def _account(conn: asyncpg.Connection, principal: Principal) -> Account:
    return await accounts_repo.get_or_create_account(
        conn, idp_sub=principal.sub, email=principal.email
    )


async def _require_role(
    conn: asyncpg.Connection, account: Account, project_id: uuid.UUID, *, allow: tuple[str, ...]
) -> str:
    """Resolve the caller's role on the project and enforce it's one of `allow`.

    `allow` is the project-role permission matrix (P0-2 slice C): owner,
    reviewer (approve/withdraw), editor (create/edit content) — see
    `access.PROJECT_ROLES`. Raises 403 for no access at all, and a distinct
    403 when the resolved role isn't permitted for this operation."""
    try:
        role = await require_project_access(conn, account_id=account.id, project_id=project_id)
    except ProjectAccessError as err:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this project") from err
    if role not in allow:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
    return role


async def _enforce_generation_cap(
    conn: asyncpg.Connection, account: Account, principal: Principal
) -> None:
    """402 when a Free-plan account is at/over the rolling generations cap.
    Pro accounts are never capped. Placed before any job/envelope is created
    on the 3 trust generate submits (T2 — the server-side gate)."""
    if await is_pro(conn, account_id=account.id):
        return
    since = datetime.now(UTC) - timedelta(days=settings.free_gen_window_days)
    if await quota.count_generations(conn, principal.sub, since) >= settings.free_max_generations:
        raise quota.pro_required(
            f"Free plan is limited to {settings.free_max_generations} generations "
            f"per {settings.free_gen_window_days} days — upgrade to Pro."
        )


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
    if not await is_pro(conn, account_id=account.id):
        if await quota.count_projects(conn, account.id) >= settings.free_max_projects:
            raise quota.pro_required(
                f"Free plan is limited to {settings.free_max_projects} projects "
                "— upgrade to Pro for more."
            )
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
    await _require_role(conn, account, project_id, allow=("owner",))
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


@router.post("/projects/{project_id}/inputs", response_model=schemas.ProjectInputOut)
async def add_project_input(
    project_id: uuid.UUID,
    body: schemas.ProjectInputIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectInputOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    try:
        i = await project_repo.add_input(
            conn,
            project_id=project_id,
            kind=body.kind,
            title=body.title,
            content=body.content,
            source_ref=body.source_ref,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    return schemas.ProjectInputOut(
        id=str(i.id),
        kind=i.kind,
        title=i.title,
        content=i.content,
        source_ref=i.source_ref,
        created_at=i.created_at,
    )


@router.patch("/inputs/{input_id}", response_model=schemas.ProjectInputOut)
async def edit_project_input(
    input_id: uuid.UUID,
    body: schemas.ProjectInputUpdateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectInputOut:
    project_id = await project_id_for_input(conn, input_id=input_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    cur = await project_repo.get_input(conn, input_id=input_id)
    if cur is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    if body.content is not None and await project_repo.input_cited_by_validated(
        conn, project_id=project_id, input_id=input_id
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This source is cited by an approved draft — unapprove that draft first to edit the source.",
        )
    i = await project_repo.update_input(
        conn,
        input_id=input_id,
        title=body.title if body.title is not None else cur.title,
        content=body.content if body.content is not None else cur.content,
        source_ref=body.source_ref if body.source_ref is not None else cur.source_ref,
    )
    return schemas.ProjectInputOut(
        id=str(i.id),
        kind=i.kind,
        title=i.title,
        content=i.content,
        source_ref=i.source_ref,
        created_at=i.created_at,
    )


@router.delete("/inputs/{input_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_input(
    input_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> None:
    project_id = await project_id_for_input(conn, input_id=input_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    if await project_repo.input_cited_by_validated(conn, project_id=project_id, input_id=input_id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This source is cited by an approved draft — unapprove that draft first to remove the source.",
        )
    await project_repo.delete_input(conn, input_id=input_id)


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
    await _require_role(conn, account, project_id, allow=("owner", "editor"))
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


@router.get("/versions/{version_id}", response_model=schemas.VersionDetailOut)
async def get_version(
    version_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.VersionDetailOut:
    project_id = await project_id_for_version(conn, version_id=version_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner", "reviewer", "editor"))  # read
    v = await artifact_repo.get_version(conn, version_id=version_id)
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    ap = await approval_repo.get_approval(conn, version_id=version_id)
    fb = await feedback_repo.list_feedback(conn, version_id=version_id)
    return schemas.VersionDetailOut(
        id=str(v.id),
        artifact_id=str(v.artifact_id),
        version_no=v.version_no,
        content=v.content or {"sections": []},
        generation_meta=v.generation_meta,
        is_validated=ap is not None and ap.action == "approve",
        recorded_via=ap.recorded_via if ap and ap.action == "approve" else None,
        created_at=v.created_at,
        feedback=[
            schemas.FeedbackOut(
                id=str(f.id),
                version_id=str(f.version_id),
                author_kind=f.author_kind,
                author_name=f.author_name,
                body=f.body,
                section_index=f.section_index,
                created_at=f.created_at,
            )
            for f in fb
        ],
    )


@router.post(
    "/artifacts/{artifact_id}/versions/generate",
    response_model=schemas.VersionGenerateJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def generate_version(
    artifact_id: uuid.UUID,
    body: schemas.DraftGenerateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
    r: redis.Redis = Depends(get_redis),
) -> schemas.VersionGenerateJobOut:
    """Submit a whole-book draft generation job (Phase C, T1 — async).

    Does the synchronous, fail-fast validation (owner-only access, artifact
    exists, project exists, has sources, managed eligibility) then hands the
    actual LLM call off to `generate_version_task` (Celery) and returns 202
    immediately. Poll the shared `GET /api/v1/jobs/{job_id}` for the eventual
    `done`/`failed` status and the created `artifact_version` id — same job
    machinery (encrypted BYOK envelope + status row) as per-topic generation
    and suggest-TOC.
    """
    project_id = await project_id_for_artifact(conn, artifact_id=artifact_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    await _enforce_generation_cap(conn, account, principal)

    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    sources = await project_repo.list_inputs(conn, project_id=project_id)
    if not sources:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "add at least one source before generating a draft",
        )

    # key handling mirrors generate_topic_version / suggest_project_toc — the
    # actual key (managed vault lookup or BYOK decrypt) is resolved by the
    # worker, not here.
    managed = body.api_key is None
    if managed:
        # Entitlement-aware managed gate (mirror generate/router.py): a plan
        # entitlement OR the staff allowlist, then the allowance/ceiling cap —
        # so a console-granted plan enables keyless generation here too, and the
        # spend ceiling binds on this surface. `account` is resolved just above.
        grant = await resolve_managed_access(
            conn, account_id=account.id, provider_id=body.provider_id, principal=principal
        )
        if grant is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "an api_key is required for this request"
            )
        if await over_cap(conn, account_id=account.id, access=grant):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "managed allowance exhausted; try again later or add your own key",
            )
    model = body.model or settings.anthropic_default_model

    job_id = uuid.uuid4()

    # BYOK only — encrypt + store the per-job envelope. Managed jobs store no
    # key; the worker reads OUR vault key (ADR-005 D6).
    if not managed:
        master_key = parse_master_key(settings.byok_master_key)
        envelope = encrypt_api_key(master_key, str(job_id), body.api_key)
        await r.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)

    await _write_status(r, job_id, "queued")

    generate_version_task.delay(
        job_id=str(job_id),
        artifact_id=str(artifact_id),
        provider_id=body.provider_id,
        model=model,
        guidance=body.guidance,
        managed=managed,
        recorded_by_sub=principal.sub,
    )

    # Safe-surface logging only — never the api_key, never the request body.
    log.info(
        "draft_generate_submitted",
        job_id=str(job_id),
        artifact_id=str(artifact_id),
        managed=managed,
    )

    return schemas.VersionGenerateJobOut(job_id=str(job_id), status="queued")


@router.post("/projects/{project_id}/invitations", response_model=schemas.InvitationOut)
async def invite_expert(
    project_id: uuid.UUID,
    body: schemas.InviteIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.InvitationOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    try:
        inv = await membership_repo.invite(
            conn,
            project_id=project_id,
            email=body.email,
            invited_by_sub=principal.sub,
            role=body.role,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    return schemas.InvitationOut(
        project_id=str(inv.project_id),
        invited_email=inv.invited_email,
        role=inv.role,
        revoked_at=inv.revoked_at,
    )


@router.get("/projects", response_model=list[schemas.ProjectSummaryOut])
async def list_owned_projects(
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[schemas.ProjectSummaryOut]:
    account = await _account(conn, principal)
    projects = await project_repo.list_projects(conn, owner_account_id=account.id)
    return [
        schemas.ProjectSummaryOut(
            id=str(p.id),
            title=p.title,
            status=p.status,
            created_at=p.created_at,
            topic=p.topic,
            audience=p.audience,
            goal=p.goal,
        )
        for p in projects
    ]


@router.get("/projects/{project_id}", response_model=schemas.ProjectDetailOut)
async def get_project(
    project_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectDetailOut:
    account = await _account(conn, principal)
    role = await _require_role(
        conn, account, project_id, allow=("owner", "reviewer", "editor")
    )  # read
    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    artifacts = []
    for a in await artifact_repo.list_artifacts(conn, project_id=project_id):
        versions = []
        for v in await artifact_repo.list_versions(conn, artifact_id=a.id):
            ap = await approval_repo.get_approval(conn, version_id=v.id)
            versions.append(
                schemas.VersionSummaryOut(
                    id=str(v.id),
                    version_no=v.version_no,
                    created_at=v.created_at,
                    is_validated=ap is not None and ap.action == "approve",
                    recorded_via=ap.recorded_via if ap and ap.action == "approve" else None,
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
    inputs = [
        schemas.ProjectInputOut(
            id=str(i.id),
            kind=i.kind,
            title=i.title,
            content=i.content,
            source_ref=i.source_ref,
            created_at=i.created_at,
        )
        for i in await project_repo.list_inputs(conn, project_id=project_id)
    ]
    topic_status, book_validated = await _topic_status_rollup(
        conn, project_id=project_id, toc=p.toc
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
            toc=p.toc,
        ),
        artifacts=artifacts,
        my_role=role,
        inputs=inputs,
        topic_status=topic_status,
        book_validated=book_validated,
    )


@router.put("/projects/{project_id}/toc", response_model=schemas.ProjectOut)
async def save_project_toc(
    project_id: uuid.UUID,
    body: schemas.TocSaveIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    if not isinstance(body.toc.get("subjects"), list):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "toc.subjects must be a list")
    await project_repo.update_project_toc(conn, project_id=project_id, toc=body.toc)
    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    return schemas.ProjectOut(
        id=str(p.id),
        title=p.title,
        topic=p.topic,
        audience=p.audience,
        goal=p.goal,
        status=p.status,
        created_at=p.created_at,
        toc=p.toc,
    )


@router.post(
    "/projects/{project_id}/suggest-toc",
    response_model=schemas.TocSuggestJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def suggest_project_toc(
    project_id: uuid.UUID,
    body: schemas.DraftGenerateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
    r: redis.Redis = Depends(get_redis),
) -> schemas.TocSuggestJobOut:
    """Submit a suggest-TOC job (Phase B, T1 — async).

    Does the synchronous, fail-fast validation (owner-only access, project
    exists, has sources, managed eligibility) then hands the actual LLM call
    off to `suggest_toc_task` (Celery) and returns 202 immediately. Poll the
    shared `GET /api/v1/jobs/{job_id}` for the eventual `done`/`failed` status
    and the suggested `toc` dict — same job machinery (encrypted BYOK
    envelope + status row) as whole-lesson `/generate` and per-topic
    `/generate`. Suggest-TOC persists nothing, so there's no created-row id
    in the result, just the `toc` dict itself.
    """
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    await _enforce_generation_cap(conn, account, principal)

    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    sources = await project_repo.list_inputs(conn, project_id=project_id)
    if not sources:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "add at least one source before suggesting a TOC",
        )

    # key handling mirrors generate_version / generate_topic_version — the
    # actual key (managed vault lookup or BYOK decrypt) is resolved by the
    # worker, not here.
    managed = body.api_key is None
    if managed:
        # Entitlement-aware managed gate (mirror generate/router.py): a plan
        # entitlement OR the staff allowlist, then the allowance/ceiling cap —
        # so a console-granted plan enables keyless generation here too, and the
        # spend ceiling binds on this surface. `account` is resolved just above.
        grant = await resolve_managed_access(
            conn, account_id=account.id, provider_id=body.provider_id, principal=principal
        )
        if grant is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "an api_key is required for this request"
            )
        if await over_cap(conn, account_id=account.id, access=grant):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "managed allowance exhausted; try again later or add your own key",
            )
    model = body.model or settings.anthropic_default_model

    job_id = uuid.uuid4()

    # BYOK only — encrypt + store the per-job envelope. Managed jobs store no
    # key; the worker reads OUR vault key (ADR-005 D6).
    if not managed:
        master_key = parse_master_key(settings.byok_master_key)
        envelope = encrypt_api_key(master_key, str(job_id), body.api_key)
        await r.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)

    await _write_status(r, job_id, "queued")

    suggest_toc_task.delay(
        job_id=str(job_id),
        project_id=str(project_id),
        provider_id=body.provider_id,
        model=model,
        managed=managed,
        recorded_by_sub=principal.sub,
    )

    # Safe-surface logging only — never the api_key, never the request body.
    log.info(
        "toc_suggest_submitted",
        job_id=str(job_id),
        project_id=str(project_id),
        managed=managed,
    )

    return schemas.TocSuggestJobOut(job_id=str(job_id), status="queued")


# Moved to toc_util.py (T2) so both this router and the async per-topic
# generate Celery task (trust/tasks.py) can import it without a router<->tasks
# import cycle. Kept as a module-level alias so the many call sites below are
# unchanged.
_find_toc_topic = find_toc_topic


def _toc_topic_ids(toc: dict | None) -> list[str]:
    ids: list[str] = []
    for subj in (toc or {}).get("subjects", []):
        for unit in subj.get("units") or []:
            ids.append(str(unit.get("id")))
    return ids


async def _topic_status_rollup(
    conn: asyncpg.Connection, *, project_id: uuid.UUID, toc: dict | None
) -> tuple[list[schemas.TopicStatusOut], bool]:
    topic_ids = _toc_topic_ids(toc)
    latest_by_topic: dict[str, object] = {}
    for v in await topic_repo.list_topic_versions(conn, project_id=project_id):
        if v.topic_id not in topic_ids:
            continue  # orphaned version — not a current toc topic; excluded
        current = latest_by_topic.get(v.topic_id)
        if current is None or v.version_no > current.version_no:
            latest_by_topic[v.topic_id] = v

    statuses: list[schemas.TopicStatusOut] = []
    for topic_id in topic_ids:
        latest = latest_by_topic.get(topic_id)
        if latest is None:
            status_value = "not_generated"
        elif await topic_approval_repo.is_topic_validated(conn, topic_version_id=latest.id):
            status_value = "validated"
        else:
            status_value = "drafted"
        statuses.append(
            schemas.TopicStatusOut(
                topic_id=topic_id,
                status=status_value,
                latest_version_id=str(latest.id) if latest is not None else None,
                version_no=latest.version_no if latest is not None else None,
            )
        )

    book_validated = bool(topic_ids) and all(s.status == "validated" for s in statuses)
    return statuses, book_validated


@router.post(
    "/projects/{project_id}/topics/{topic_id}/generate",
    response_model=schemas.TopicGenerateJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def generate_topic_version(
    project_id: uuid.UUID,
    topic_id: str,
    body: schemas.DraftGenerateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
    r: redis.Redis = Depends(get_redis),
) -> schemas.TopicGenerateJobOut:
    """Submit a per-topic generation job (Phase A, T2 — async).

    Does the synchronous, fail-fast validation (owner-only access, topic
    exists, has sources, managed eligibility) then hands the actual LLM call
    off to `generate_topic_task` (Celery) and returns 202 immediately. Poll
    the shared `GET /api/v1/jobs/{job_id}` for the eventual `done`/`failed`
    status and the created `topic_version` id — same job machinery
    (encrypted BYOK envelope + status row) as whole-lesson `/generate`.
    """
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    await _enforce_generation_cap(conn, account, principal)

    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    topic = _find_toc_topic(p.toc, topic_id)
    if topic is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "topic not found")

    topic_source_ids = topic.get("source_ids") or []
    all_inputs = await project_repo.list_inputs(conn, project_id=project_id)
    inputs_by_id = {str(i.id): i for i in all_inputs}
    sources = [inputs_by_id[sid] for sid in topic_source_ids if sid in inputs_by_id]
    if not sources:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "add at least one source to this topic before generating",
        )

    # key handling mirrors generate_version / suggest_project_toc — the actual
    # key (managed vault lookup or BYOK decrypt) is resolved by the worker,
    # not here.
    managed = body.api_key is None
    if managed:
        # Entitlement-aware managed gate (mirror generate/router.py): a plan
        # entitlement OR the staff allowlist, then the allowance/ceiling cap —
        # so a console-granted plan enables keyless generation here too, and the
        # spend ceiling binds on this surface. `account` is resolved just above.
        grant = await resolve_managed_access(
            conn, account_id=account.id, provider_id=body.provider_id, principal=principal
        )
        if grant is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "an api_key is required for this request"
            )
        if await over_cap(conn, account_id=account.id, access=grant):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "managed allowance exhausted; try again later or add your own key",
            )
    model = body.model or settings.anthropic_default_model

    job_id = uuid.uuid4()

    # BYOK only — encrypt + store the per-job envelope. Managed jobs store no
    # key; the worker reads OUR vault key (ADR-005 D6).
    if not managed:
        master_key = parse_master_key(settings.byok_master_key)
        envelope = encrypt_api_key(master_key, str(job_id), body.api_key)
        await r.set(_byok_redis_key(job_id), envelope, ex=settings.byok_redis_ttl_seconds)

    await _write_status(r, job_id, "queued")

    generate_topic_task.delay(
        job_id=str(job_id),
        project_id=str(project_id),
        topic_id=topic_id,
        provider_id=body.provider_id,
        model=model,
        guidance=body.guidance,
        managed=managed,
        recorded_by_sub=principal.sub,
    )

    # Safe-surface logging only — never the api_key, never the request body.
    log.info(
        "topic_generate_submitted",
        job_id=str(job_id),
        project_id=str(project_id),
        topic_id=topic_id,
        managed=managed,
    )

    return schemas.TopicGenerateJobOut(job_id=str(job_id), status="queued")


@router.get(
    "/projects/{project_id}/generate-book/estimate",
    response_model=schemas.BookEstimateOut,
)
async def get_generate_book_estimate(
    project_id: uuid.UUID,
    provider_id: str = "anthropic",
    model: str | None = None,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.BookEstimateOut:
    """Pre-run token/cost estimate for the whole-book generate fan-out.

    Read-only, but gated owner-only to match the generate-book action it
    estimates (the same gate `generate_topic_version` uses)."""
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))

    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")

    existing_topic_ids = {
        v.topic_id for v in await topic_repo.list_topic_versions(conn, project_id=project_id)
    }
    missing = book_gen.missing_topics(p, existing_topic_ids)
    all_inputs = await project_repo.list_inputs(conn, project_id=project_id)
    inputs_by_id = {str(i.id): i for i in all_inputs}
    resolved_model = model or settings.anthropic_default_model
    est = book_gen.estimate(missing, inputs_by_id, provider_id, resolved_model)

    # Managed-eligible callers get their remaining headroom; BYOK/ineligible
    # callers get None — there's no cap to measure against.
    remaining_micros: int | None = None
    grant = await resolve_managed_access(
        conn, account_id=account.id, provider_id=provider_id, principal=principal
    )
    if grant is not None:
        limits = [
            x
            for x in (grant.allowance_micros, settings.managed_account_spend_ceiling_micros)
            if x > 0
        ]
        if limits:
            usage = await usage_repo.period_usage(conn, account_id=account.id, since=grant.since)
            remaining_micros = min(limits) - usage.cost_micros

    would_exceed = remaining_micros is not None and est.est_cost_micros_max > remaining_micros

    return schemas.BookEstimateOut(
        missing_topics=est.missing_topics,
        est_input_tokens=est.est_input_tokens,
        est_output_tokens_max=est.est_output_tokens_max,
        est_cost_micros_max=est.est_cost_micros_max,
        remaining_micros=remaining_micros,
        would_exceed=would_exceed,
    )


def _generation_job_out(job) -> schemas.GenerationJobOut:
    return schemas.GenerationJobOut(
        id=str(job.id),
        project_id=str(job.project_id),
        status=job.status,
        total=job.total,
        done=job.done,
        failed_topic_ids=job.failed_topic_ids,
        created_at=job.created_at,
    )


@router.post(
    "/projects/{project_id}/generate-book",
    response_model=schemas.GenerateBookJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def submit_generate_book(
    project_id: uuid.UUID,
    body: schemas.GenerateBookIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
    r: redis.Redis = Depends(get_redis),
) -> schemas.GenerateBookJobOut:
    """Submit the whole-book generate fan-out (ADR-037 book generation, T4).

    Does the synchronous, fail-fast validation (owner-only access, a TOC with
    at least one still-missing topic, managed eligibility) then creates the
    durable `generation_job` row — `total=len(missing)` set HERE, computed
    the SAME way the worker (`trust.tasks._run_book`) computes it
    (`book_gen.missing_topics` over `topic_repo.list_topic_versions`), since
    the worker trusts this number rather than recomputing it — and hands the
    actual sequential fan-out off to `generate_book_task` (Celery), returning
    202 immediately. Poll `GET /generation-jobs/{job_id}` (or
    `GET /projects/{project_id}/generation-jobs/latest`) for progress — this
    job's progress lives in the durable `generation_job` row, not the
    ephemeral Redis status blob the single-shot generations use.
    """
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    await _enforce_generation_cap(conn, account, principal)

    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")

    existing_topic_ids = {
        v.topic_id for v in await topic_repo.list_topic_versions(conn, project_id=project_id)
    }
    missing = book_gen.missing_topics(p, existing_topic_ids)
    if not missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "no TOC topics left to generate — add a TOC with at least one ungenerated topic",
        )

    # key handling mirrors generate_topic_version / generate_version /
    # suggest_project_toc — the actual key (managed vault lookup or BYOK
    # decrypt) is resolved by the worker, not here. The worker also re-checks
    # the managed spend cap before EACH topic (a single upfront check here
    # can't account for spend accrued by topics generated earlier in the same
    # run), so there's no `over_cap` pre-check on this submit.
    managed = body.api_key is None
    if managed:
        grant = await resolve_managed_access(
            conn, account_id=account.id, provider_id=body.provider_id, principal=principal
        )
        if grant is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "an api_key is required for this request"
            )
    model = body.model or settings.anthropic_default_model

    job = await generation_job_repo.create(
        conn, project_id=project_id, total=len(missing), created_by_sub=principal.sub
    )

    # BYOK only — encrypt + store the per-job envelope. Managed jobs store no
    # key; the worker reads OUR vault key (ADR-005 D6).
    if not managed:
        master_key = parse_master_key(settings.byok_master_key)
        envelope = encrypt_api_key(master_key, str(job.id), body.api_key)
        await r.set(_byok_redis_key(job.id), envelope, ex=settings.byok_redis_ttl_seconds)

    generate_book_task.delay(
        job_id=str(job.id),
        project_id=str(project_id),
        provider_id=body.provider_id,
        model=model,
        managed=managed,
        recorded_by_sub=principal.sub,
    )

    # Safe-surface logging only — never the api_key, never the request body.
    log.info(
        "generate_book_submitted",
        job_id=str(job.id),
        project_id=str(project_id),
        total=job.total,
        managed=managed,
    )

    return schemas.GenerateBookJobOut(job_id=str(job.id), total=job.total)


@router.get("/generation-jobs/{job_id}", response_model=schemas.GenerationJobOut)
async def get_generation_job(
    job_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.GenerationJobOut:
    job = await generation_job_repo.get(conn, job_id=job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "generation job not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, job.project_id, allow=("owner",))
    return _generation_job_out(job)


@router.get(
    "/projects/{project_id}/generation-jobs/latest",
    response_model=schemas.GenerationJobOut | None,
)
async def get_latest_generation_job(
    project_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.GenerationJobOut | None:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner",))
    job = await generation_job_repo.latest_for_project(conn, project_id=project_id)
    return _generation_job_out(job) if job is not None else None


@router.get("/topic-versions/{topic_version_id}", response_model=schemas.TopicVersionDetailOut)
async def get_topic_version(
    topic_version_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.TopicVersionDetailOut:
    project_id = await topic_repo.project_id_for_topic_version(
        conn, topic_version_id=topic_version_id
    )
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "topic version not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner", "reviewer", "editor"))  # read
    tv = await topic_repo.get_topic_version(conn, topic_version_id=topic_version_id)
    if tv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "topic version not found")
    latest = await topic_approval_repo.get_latest_topic_approval(
        conn, topic_version_id=topic_version_id
    )
    return schemas.TopicVersionDetailOut(
        id=str(tv.id),
        topic_id=tv.topic_id,
        title=tv.title,
        content=tv.content or {"sections": []},
        version_no=tv.version_no,
        created_at=tv.created_at,
        is_validated=latest is not None and latest.action == "approve",
        recorded_via=latest.recorded_via if latest and latest.action == "approve" else None,
        generation_meta=tv.generation_meta,
        feedback=[
            schemas.TopicFeedbackOut(
                id=str(f.id),
                topic_version_id=str(f.topic_version_id),
                author_kind=f.author_kind,
                author_name=f.author_name,
                body=f.body,
                created_at=f.created_at,
            )
            for f in await topic_feedback_repo.list_topic_feedback(
                conn, topic_version_id=topic_version_id
            )
        ],
    )


@router.get(
    "/projects/{project_id}/topics/{topic_id}/versions",
    response_model=list[schemas.TopicVersionSummaryOut],
)
async def list_topic_version_history(
    project_id: uuid.UUID,
    topic_id: str,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[schemas.TopicVersionSummaryOut]:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner", "reviewer", "editor"))  # read
    vs = await topic_repo.list_topic_versions(conn, project_id=project_id)
    return [
        schemas.TopicVersionSummaryOut(
            id=str(v.id),
            version_no=v.version_no,
            created_at=v.created_at,
            is_validated=await topic_approval_repo.is_topic_validated(conn, topic_version_id=v.id),
        )
        for v in vs
        if v.topic_id == topic_id
    ]


@router.get(
    "/projects/{project_id}/feedback",
    response_model=list[schemas.ProjectFeedbackItemOut],
)
async def list_project_feedback(
    project_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[schemas.ProjectFeedbackItemOut]:
    """Project-wide revision-notes rollup — every feedback note across every
    artifact version and topic version in the project, newest first.
    Read-only; owner OR reviewer."""
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner", "reviewer", "editor"))  # read
    rows = await feedback_repo.list_project_feedback(conn, project_id=project_id)
    return [schemas.ProjectFeedbackItemOut(**r) for r in rows]


@router.post(
    "/projects/{project_id}/topics/{topic_id}/versions",
    response_model=schemas.TopicVersionOut,
)
async def create_topic_version_manual(
    project_id: uuid.UUID,
    topic_id: str,
    body: schemas.TopicVersionContentIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.TopicVersionOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, allow=("owner", "editor"))
    existing = [
        v
        for v in await topic_repo.list_topic_versions(conn, project_id=project_id)
        if v.topic_id == topic_id
    ]
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "topic not found")
    # list_topic_versions orders by topic_id, version_no -> last = latest
    title = existing[-1].title
    sections = body.content.get("sections", []) if isinstance(body.content, dict) else []
    source_ids = sorted(
        {
            str(sid)
            for s in sections
            if isinstance(s, dict) and isinstance(s.get("source_ids"), list)
            for sid in s["source_ids"]
        }
    )
    v = await topic_repo.create_topic_version(
        conn,
        project_id=project_id,
        topic_id=topic_id,
        title=title,
        source_ids=source_ids,
        content=body.content,
        created_by_sub=principal.sub,
        generation_meta={"kind": "manual_edit", "source_input_ids": source_ids},
    )
    return schemas.TopicVersionOut(
        id=str(v.id),
        topic_id=v.topic_id,
        title=v.title,
        content=v.content or {"sections": []},
        version_no=v.version_no,
        created_at=v.created_at,
    )


@router.post("/versions/{version_id}/approvals", response_model=schemas.ApprovalOut)
async def record_version_approval(
    version_id: uuid.UUID,
    body: schemas.ApprovalIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ApprovalOut:
    project_id = await project_id_for_version(conn, version_id=version_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    account = await _account(conn, principal)
    role = await _require_role(conn, account, project_id, allow=("owner", "reviewer"))
    if role == "reviewer":
        recorded_via = "expert_self"
        expert_name = account.email or principal.sub
        expert_email = account.email
        expert_role = body.expert_role
    else:  # owner records on a named expert's behalf
        recorded_via = "operator"
        if not body.expert_name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "expert_name is required when an owner records an approval",
            )
        expert_name = body.expert_name
        expert_email = body.expert_email
        expert_role = body.expert_role
    ap = await approval_repo.record_approval(
        conn,
        version_id=version_id,
        expert_name=expert_name,
        approved_at=body.approved_at,
        recorded_by_sub=principal.sub,
        expert_email=expert_email,
        expert_role=expert_role,
        note=body.note,
        recorded_via=recorded_via,
    )
    return schemas.ApprovalOut(
        id=str(ap.id),
        version_id=str(ap.version_id),
        expert_name=ap.expert_name,
        approved_at=ap.approved_at,
        recorded_via=ap.recorded_via,
        action=ap.action,
    )


@router.post("/versions/{version_id}/approvals/withdraw", response_model=schemas.ApprovalOut)
async def withdraw_version_approval(
    version_id: uuid.UUID,
    body: schemas.WithdrawIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ApprovalOut:
    """Revoke the current approval on a version (append-only 'withdraw' record).
    Owner OR reviewer, mirroring who may approve. 409 if not currently approved."""
    project_id = await project_id_for_version(conn, version_id=version_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    account = await _account(conn, principal)
    role = await _require_role(conn, account, project_id, allow=("owner", "reviewer"))
    recorded_via = "expert_self" if role == "reviewer" else "operator"
    ap = await approval_repo.withdraw_approval(
        conn,
        version_id=version_id,
        recorded_by_sub=principal.sub,
        recorded_via=recorded_via,
        note=body.note,
    )
    if ap is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "version is not currently approved")
    return schemas.ApprovalOut(
        id=str(ap.id),
        version_id=str(ap.version_id),
        expert_name=ap.expert_name,
        approved_at=ap.approved_at,
        recorded_via=ap.recorded_via,
        action=ap.action,
    )


@router.post(
    "/topic-versions/{topic_version_id}/approvals", response_model=schemas.TopicApprovalOut
)
async def record_topic_version_approval(
    topic_version_id: uuid.UUID,
    body: schemas.ApprovalIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.TopicApprovalOut:
    project_id = await topic_repo.project_id_for_topic_version(
        conn, topic_version_id=topic_version_id
    )
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "topic version not found")
    account = await _account(conn, principal)
    role = await _require_role(conn, account, project_id, allow=("owner", "reviewer"))
    if role == "reviewer":
        recorded_via = "expert_self"
        expert_name = account.email or principal.sub
        expert_email = account.email
        expert_role = body.expert_role
    else:  # owner records on a named expert's behalf
        recorded_via = "operator"
        if not body.expert_name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "expert_name is required when an owner records an approval",
            )
        expert_name = body.expert_name
        expert_email = body.expert_email
        expert_role = body.expert_role
    ap = await topic_approval_repo.record_topic_approval(
        conn,
        topic_version_id=topic_version_id,
        expert_name=expert_name,
        approved_at=body.approved_at,
        recorded_by_sub=principal.sub,
        expert_email=expert_email,
        expert_role=expert_role,
        note=body.note,
        recorded_via=recorded_via,
    )
    return schemas.TopicApprovalOut(
        id=str(ap.id),
        topic_version_id=str(ap.topic_version_id),
        expert_name=ap.expert_name,
        approved_at=ap.approved_at,
        recorded_via=ap.recorded_via,
        action=ap.action,
    )


@router.post(
    "/topic-versions/{topic_version_id}/approvals/withdraw",
    response_model=schemas.TopicApprovalOut,
)
async def withdraw_topic_version_approval(
    topic_version_id: uuid.UUID,
    body: schemas.WithdrawIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.TopicApprovalOut:
    """Revoke the current approval on a topic version (append-only 'withdraw' record).
    Owner OR reviewer, mirroring who may approve. 409 if not currently approved."""
    project_id = await topic_repo.project_id_for_topic_version(
        conn, topic_version_id=topic_version_id
    )
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "topic version not found")
    account = await _account(conn, principal)
    role = await _require_role(conn, account, project_id, allow=("owner", "reviewer"))
    recorded_via = "expert_self" if role == "reviewer" else "operator"
    ap = await topic_approval_repo.withdraw_topic_approval(
        conn,
        topic_version_id=topic_version_id,
        recorded_by_sub=principal.sub,
        recorded_via=recorded_via,
        note=body.note,
    )
    if ap is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "topic version is not currently approved")
    return schemas.TopicApprovalOut(
        id=str(ap.id),
        topic_version_id=str(ap.topic_version_id),
        expert_name=ap.expert_name,
        approved_at=ap.approved_at,
        recorded_via=ap.recorded_via,
        action=ap.action,
    )


@router.post("/versions/{version_id}/feedback", response_model=schemas.FeedbackOut)
async def add_version_feedback(
    version_id: uuid.UUID,
    body: schemas.FeedbackIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.FeedbackOut:
    """Record a revision note on a version. Owner OR reviewer; author_kind is
    derived from role (reviewer → expert, owner → operator)."""
    text = body.body.strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "feedback body is required")
    project_id = await project_id_for_version(conn, version_id=version_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    account = await _account(conn, principal)
    role = await _require_role(conn, account, project_id, allow=("owner", "reviewer", "editor"))
    if body.section_index is not None:
        v = await artifact_repo.get_version(conn, version_id=version_id)
        if v is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
        sections = (v.content or {}).get("sections", [])
        if not (0 <= body.section_index < len(sections)):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "section_index out of range")
    author_kind = "expert" if role == "reviewer" else "operator"
    f = await feedback_repo.add_feedback(
        conn,
        version_id=version_id,
        author_kind=author_kind,
        author_name=account.email or principal.sub,
        body=text,
        recorded_by_sub=principal.sub,
        section_index=body.section_index,
    )
    return schemas.FeedbackOut(
        id=str(f.id),
        version_id=str(f.version_id),
        author_kind=f.author_kind,
        author_name=f.author_name,
        body=f.body,
        section_index=f.section_index,
        created_at=f.created_at,
    )


@router.post("/topic-versions/{topic_version_id}/feedback", response_model=schemas.TopicFeedbackOut)
async def add_topic_version_feedback(
    topic_version_id: uuid.UUID,
    body: schemas.FeedbackIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.TopicFeedbackOut:
    """Record a revision note on a topic version. Owner OR reviewer; author_kind is
    derived from role (reviewer → expert, owner → operator)."""
    text = body.body.strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "feedback body is required")
    project_id = await topic_repo.project_id_for_topic_version(
        conn, topic_version_id=topic_version_id
    )
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "topic version not found")
    account = await _account(conn, principal)
    role = await _require_role(conn, account, project_id, allow=("owner", "reviewer", "editor"))
    author_kind = "expert" if role == "reviewer" else "operator"
    f = await topic_feedback_repo.add_topic_feedback(
        conn,
        topic_version_id=topic_version_id,
        author_kind=author_kind,
        author_name=account.email or principal.sub,
        body=text,
        recorded_by_sub=principal.sub,
    )
    return schemas.TopicFeedbackOut(
        id=str(f.id),
        topic_version_id=str(f.topic_version_id),
        author_kind=f.author_kind,
        author_name=f.author_name,
        body=f.body,
        created_at=f.created_at,
    )
