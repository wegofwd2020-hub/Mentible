"""POST /api/v1/derivatives/post for StudyBuddy Q (ADR-037 D8).

Unlike /generate (async job + poll — a lesson can take minutes), a derivative
post is small enough to generate inline and return in the same request. Key
selection mirrors `generate/router.py`'s BYOK-vs-managed split: a key in the
body is BYOK; its absence selects the managed path, gated by
`is_managed_eligible` (a generic 400 on ineligibility — never reveals allowlist
membership). The handler NEVER logs or echoes the api_key.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from wegofwd_llm.errors import LLMAuthError, LLMSchemaError

from backend.config import settings
from backend.src.auth.deps import optional_user
from backend.src.auth.principal import Principal
from backend.src.billing.eligibility import is_managed_eligible
from backend.src.billing.vault import get_managed_key
from backend.src.core.log_redaction import get_logger
from backend.src.core.rate_limit import enforce_rate_limit
from backend.src.derivatives.generate import generate_post
from backend.src.derivatives.schemas import DerivativeRequest, DerivativeResponse

router = APIRouter(prefix="/api/v1/derivatives", tags=["derivatives"])
log = get_logger("derivatives")


@router.post(
    "/post",
    response_model=DerivativeResponse,
    dependencies=[Depends(enforce_rate_limit)],
)
async def make_post(
    body: DerivativeRequest,
    principal: Principal | None = Depends(optional_user),
) -> DerivativeResponse:
    """Generate 3 platform-scoped promotional post variants for `body.source_text`.

    Key path (mirrors /generate — ADR-005 D6): a key in the body is BYOK; its
    absence selects the managed path, which requires an eligible principal
    (else a generic 400, no allowlist detail). Runs the (blocking) provider
    call off the event loop via `asyncio.to_thread`. A model that never returns
    schema-valid JSON within the repair budget surfaces as a 502 — never the key.
    """
    managed = body.api_key is None
    if managed:
        if not is_managed_eligible(principal, body.provider_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="an api_key is required for this request",
            )
        api_key = get_managed_key(body.provider_id)
    else:
        api_key = body.api_key

    model = body.model or settings.anthropic_default_model

    try:
        return await asyncio.to_thread(
            generate_post,
            source_text=body.source_text,
            platform=body.platform,
            tone=body.tone,
            provider_id=body.provider_id,
            api_key=api_key,
            model=model,
        )
    except LLMSchemaError:
        log.warning("derivative_validation_failed", platform=body.platform)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="generated content failed validation",
        ) from None
    except LLMAuthError:
        # The provider rejected the key (401/403) — actionable, key-free (mirrors
        # generate/tasks.py's LLMAuthError handling).
        log.warning("derivative_auth_rejected", platform=body.platform)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "The API key was rejected by the provider. Check it in Settings — "
                "it may be invalid, revoked, or out of credit."
            ),
        ) from None
