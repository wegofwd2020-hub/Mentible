from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, status

from backend.src.accounts import repo as accounts_repo
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal
from backend.src.core.rate_limit import enforce_rate_limit
from backend.src.db.deps import get_conn
from backend.src.feedback import repo
from backend.src.feedback.email import send_feedback_email
from backend.src.feedback.schemas import FeedbackIn, FeedbackOut

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])


@router.post(
    "",
    response_model=FeedbackOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def submit_feedback(
    body: FeedbackIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> FeedbackOut:
    """Capture in-app feedback. Storage is PRIMARY (analyzable JSON row); the
    support email is best-effort on top. The submitter's email is taken from the
    verified principal, never the client body."""
    account = await accounts_repo.get_or_create_account(
        conn, idp_sub=principal.sub, email=principal.email
    )
    email = principal.email or ""
    payload = {
        "type": body.type.value,
        "company": body.company,
        "role": body.role,
        "contact_preference": body.contact_preference.value,
        "text": body.text,
    }
    row = await repo.insert_feedback(
        conn,
        account_id=account.id,
        name=body.name,
        email=email,
        page=body.page,
        payload=payload,
    )
    # Best-effort notification — never fails the capture.
    await send_feedback_email(name=body.name, email=email, page=body.page, payload=payload)
    return FeedbackOut(
        id=str(row["id"]),
        created_at=row["created_at"].isoformat() if row["created_at"] else None,
    )
