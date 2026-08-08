from __future__ import annotations

import asyncio
import uuid

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from wegofwd_llm.errors import (
    LLMAuthError,
    LLMError,
    LLMRateLimitError,
    LLMSchemaError,
)

from backend.config import settings

from ..accounts import repo as accounts_repo
from ..accounts.deps import require_active_user
from ..accounts.models import Account
from ..auth.principal import Principal
from ..billing.eligibility import is_managed_eligible
from ..billing.vault import get_managed_key
from ..core.log_redaction import get_logger
from ..core.rate_limit import enforce_rate_limit
from ..db.deps import get_conn
from . import (
    approval_repo,
    artifact_repo,
    feedback_repo,
    membership_repo,
    project_repo,
    schemas,
    topic_approval_repo,
    topic_repo,
)
from .access import (
    ProjectAccessError,
    project_id_for_artifact,
    project_id_for_input,
    project_id_for_version,
    require_project_access,
)
from .generate import generate_draft
from .generate_topic import generate_topic_draft
from .toc_suggest import suggest_toc

router = APIRouter(prefix="/api/v1/trust", tags=["trust"])
log = get_logger("trust")


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


@router.post("/projects/{project_id}/inputs", response_model=schemas.ProjectInputOut)
async def add_project_input(
    project_id: uuid.UUID,
    body: schemas.ProjectInputIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectInputOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
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
    await _require_role(conn, account, project_id, need_owner=True)
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
    await _require_role(conn, account, project_id, need_owner=True)
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
    await _require_role(conn, account, project_id, need_owner=False)  # owner OR reviewer
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
                created_at=f.created_at,
            )
            for f in fb
        ],
    )


@router.post(
    "/artifacts/{artifact_id}/versions/generate",
    response_model=schemas.VersionOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def generate_version(
    artifact_id: uuid.UUID,
    body: schemas.DraftGenerateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.VersionOut:
    project_id = await project_id_for_artifact(conn, artifact_id=artifact_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)

    fmt = await conn.fetchval("SELECT format FROM artifact WHERE id=$1", artifact_id)
    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    sources = await project_repo.list_inputs(conn, project_id=project_id)
    if not sources:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "add at least one source before generating a draft",
        )

    # key handling mirrors /derivatives
    managed = body.api_key is None
    if managed:
        if not is_managed_eligible(principal, body.provider_id):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "an api_key is required for this request"
            )
        api_key = get_managed_key(body.provider_id)
    else:
        api_key = body.api_key
    model = body.model or settings.anthropic_default_model

    try:
        out = await asyncio.to_thread(
            generate_draft,
            sources=sources,
            artifact_format=fmt,
            topic=p.topic,
            audience=p.audience,
            goal=p.goal,
            provider_id=body.provider_id,
            api_key=api_key,
            model=model,
            guidance=body.guidance,
        )
    except LLMSchemaError:
        log.warning("draft_generation_failed", reason="schema", artifact_id=str(artifact_id))
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "generated draft failed validation"
        ) from None
    except LLMAuthError:
        log.warning("draft_generation_failed", reason="auth", artifact_id=str(artifact_id))
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "The API key was rejected by the provider. Check it in Settings.",
        ) from None
    except LLMRateLimitError:
        log.warning("draft_generation_failed", reason="rate_limit", artifact_id=str(artifact_id))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "The provider is rate-limiting requests. Try again shortly.",
        ) from None
    except LLMError:
        log.warning("draft_generation_failed", reason="llm_error", artifact_id=str(artifact_id))
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "draft generation failed") from None
    except Exception:
        # Defense in depth: never let a raw error escape with key material.
        log.warning("draft_generation_failed", reason="unexpected", artifact_id=str(artifact_id))
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "draft generation failed") from None

    # map model labels S1..Sn -> real input ids (drop unknowns; never 500 on a bad label)
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    sections = [
        {
            "heading": sec.heading,
            "body": sec.body,
            "source_ids": [by_label[label] for label in sec.sources if label in by_label],
        }
        for sec in out.sections
    ]
    cited = sorted({sid for s in sections for sid in s["source_ids"]})
    v = await artifact_repo.create_version(
        conn,
        artifact_id=artifact_id,
        content={"sections": sections},
        created_by_sub=principal.sub,
        generation_meta={
            "kind": "draft",
            "model": model,
            "provider_id": body.provider_id,
            "source_input_ids": cited,
            **({"guidance": body.guidance} if body.guidance else {}),
        },
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
    role = await _require_role(conn, account, project_id, need_owner=False)
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
    )


@router.put("/projects/{project_id}/toc", response_model=schemas.ProjectOut)
async def save_project_toc(
    project_id: uuid.UUID,
    body: schemas.TocSaveIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
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
    response_model=schemas.TocSuggestOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def suggest_project_toc(
    project_id: uuid.UUID,
    body: schemas.DraftGenerateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.TocSuggestOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)

    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    sources = await project_repo.list_inputs(conn, project_id=project_id)
    if not sources:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "add at least one source before suggesting a TOC",
        )

    # key handling mirrors generate_version / /derivatives
    managed = body.api_key is None
    if managed:
        if not is_managed_eligible(principal, body.provider_id):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "an api_key is required for this request"
            )
        api_key = get_managed_key(body.provider_id)
    else:
        api_key = body.api_key
    model = body.model or settings.anthropic_default_model

    try:
        out = await asyncio.to_thread(
            suggest_toc,
            sources=sources,
            topic=p.topic,
            audience=p.audience,
            goal=p.goal,
            provider_id=body.provider_id,
            api_key=api_key,
            model=model,
        )
    except LLMSchemaError:
        log.warning("toc_suggest_failed", reason="schema", project_id=str(project_id))
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "suggested TOC failed validation"
        ) from None
    except LLMAuthError:
        log.warning("toc_suggest_failed", reason="auth", project_id=str(project_id))
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "The API key was rejected by the provider. Check it in Settings.",
        ) from None
    except LLMRateLimitError:
        log.warning("toc_suggest_failed", reason="rate_limit", project_id=str(project_id))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "The provider is rate-limiting requests. Try again shortly.",
        ) from None
    except LLMError:
        log.warning("toc_suggest_failed", reason="llm_error", project_id=str(project_id))
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "TOC suggestion failed") from None
    except Exception:
        # Defense in depth: never let a raw error escape with key material.
        log.warning("toc_suggest_failed", reason="unexpected", project_id=str(project_id))
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "TOC suggestion failed") from None

    # map model labels S1..Sn -> real input ids (drop unknowns; never 500 on a bad label)
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    toc = {
        "subjects": [
            {
                "subject_label": subj.subject_label,
                "units": [
                    {
                        "id": str(uuid.uuid4()),
                        "title": t.title,
                        "subtopics": [
                            ({"label": st.label, "detail": st.detail} if st.detail else st.label)
                            for st in t.subtopics
                        ],
                        "prerequisites": [],
                        "source_ids": [by_label[lbl] for lbl in t.sources if lbl in by_label],
                    }
                    for t in subj.topics
                ],
            }
            for subj in out.subjects
        ]
    }
    return schemas.TocSuggestOut(toc=toc)


def _find_toc_topic(toc: dict | None, topic_id: str) -> dict | None:
    for subj in (toc or {}).get("subjects", []):
        for unit in subj.get("units", []):
            if str(unit.get("id")) == topic_id:
                return unit
    return None


@router.post(
    "/projects/{project_id}/topics/{topic_id}/generate",
    response_model=schemas.TopicVersionOut,
    dependencies=[Depends(enforce_rate_limit)],
)
async def generate_topic_version(
    project_id: uuid.UUID,
    topic_id: str,
    body: schemas.DraftGenerateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.TopicVersionOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)

    p = await project_repo.get_project(conn, project_id=project_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    topic = _find_toc_topic(p.toc, topic_id)
    if topic is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "topic not found")

    topic_title = topic.get("title") or ""
    subtopics = [
        st.get("label") if isinstance(st, dict) else st for st in topic.get("subtopics", [])
    ]
    topic_source_ids = topic.get("source_ids") or []
    all_inputs = await project_repo.list_inputs(conn, project_id=project_id)
    inputs_by_id = {str(i.id): i for i in all_inputs}
    sources = [inputs_by_id[sid] for sid in topic_source_ids if sid in inputs_by_id]
    if not sources:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "add at least one source to this topic before generating",
        )

    # key handling mirrors generate_version / suggest_project_toc
    managed = body.api_key is None
    if managed:
        if not is_managed_eligible(principal, body.provider_id):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "an api_key is required for this request"
            )
        api_key = get_managed_key(body.provider_id)
    else:
        api_key = body.api_key
    model = body.model or settings.anthropic_default_model

    try:
        out = await asyncio.to_thread(
            generate_topic_draft,
            sources=sources,
            topic_title=topic_title,
            subtopics=subtopics,
            audience=p.audience,
            goal=p.goal,
            provider_id=body.provider_id,
            api_key=api_key,
            model=model,
        )
    except LLMSchemaError:
        log.warning("topic_generation_failed", reason="schema", topic_id=topic_id)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "generated topic draft failed validation"
        ) from None
    except LLMAuthError:
        log.warning("topic_generation_failed", reason="auth", topic_id=topic_id)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "The API key was rejected by the provider. Check it in Settings.",
        ) from None
    except LLMRateLimitError:
        log.warning("topic_generation_failed", reason="rate_limit", topic_id=topic_id)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "The provider is rate-limiting requests. Try again shortly.",
        ) from None
    except LLMError:
        log.warning("topic_generation_failed", reason="llm_error", topic_id=topic_id)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "topic generation failed") from None
    except Exception:
        # Defense in depth: never let a raw error escape with key material.
        log.warning("topic_generation_failed", reason="unexpected", topic_id=topic_id)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "topic generation failed") from None

    # map model labels S1..Sn -> real input ids, scoped to THIS topic's sources
    # (drop unknowns; never 500 on a bad label)
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    sections = [
        {
            "heading": sec.heading,
            "body": sec.body,
            "source_ids": [by_label[label] for label in sec.sources if label in by_label],
        }
        for sec in out.sections
    ]
    v = await topic_repo.create_topic_version(
        conn,
        project_id=project_id,
        topic_id=topic_id,
        title=topic_title,
        source_ids=topic_source_ids,
        content={"sections": sections},
        created_by_sub=principal.sub,
    )
    return schemas.TopicVersionOut(
        id=str(v.id),
        topic_id=v.topic_id,
        title=v.title,
        content=v.content,
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
    role = await _require_role(conn, account, project_id, need_owner=False)
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
    role = await _require_role(conn, account, project_id, need_owner=False)
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
    role = await _require_role(conn, account, project_id, need_owner=False)
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
    role = await _require_role(conn, account, project_id, need_owner=False)
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
    role = await _require_role(conn, account, project_id, need_owner=False)
    author_kind = "expert" if role == "reviewer" else "operator"
    f = await feedback_repo.add_feedback(
        conn,
        version_id=version_id,
        author_kind=author_kind,
        author_name=account.email or principal.sub,
        body=text,
        recorded_by_sub=principal.sub,
    )
    return schemas.FeedbackOut(
        id=str(f.id),
        version_id=str(f.version_id),
        author_kind=f.author_kind,
        author_name=f.author_name,
        body=f.body,
        created_at=f.created_at,
    )
