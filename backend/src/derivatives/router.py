"""POST /api/v1/derivatives/post for StudyBuddy Q (ADR-037 D8).

Unlike /generate (async job + poll — a lesson can take minutes), a derivative
post is small enough to generate inline and return in the same request. Key
selection mirrors `generate/router.py`'s BYOK-vs-managed split: a key in the
body is BYOK; its absence selects the managed path, resolved the same way as
/generate (accounts_repo -> billing.access.resolve_managed_access -> over_cap),
with the Phase-1 staff allowlist (`is_managed_eligible`) as the no-DB fallback.
Ineligible/over-cap never reveals allowlist or entitlement detail. The handler
NEVER logs or echoes the api_key.
"""

from __future__ import annotations

import asyncio
import base64
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from wegofwd_llm.errors import (
    LLMAuthError,
    LLMError,
    LLMRateLimitError,
    LLMSchemaError,
)
from wegofwd_llm.registry import PROVIDER_REGISTRY

from backend.config import settings
from backend.src.accounts import repo as accounts_repo
from backend.src.auth.deps import optional_user
from backend.src.auth.principal import Principal
from backend.src.billing import access, pricing, usage_repo
from backend.src.billing.eligibility import is_managed_eligible
from backend.src.billing.vault import get_managed_key
from backend.src.core.log_redaction import get_logger
from backend.src.core.rate_limit import enforce_rate_limit
from backend.src.derivatives.generate import (
    generate_card,
    generate_carousel,
    generate_narration,
    generate_post,
)
from backend.src.derivatives.render import (
    CardRenderError,
    compile_animated_gif,
    compile_card_png,
    compile_carousel_png,
)
from backend.src.derivatives.schemas import (
    AnimatedRequest,
    AnimatedResponse,
    AudioRequest,
    AudioResponse,
    CardContent,
    CardRequest,
    CardResponse,
    CarouselFrame,
    CarouselRequest,
    CarouselResponse,
    DerivativeRequest,
    DerivativeResponse,
)
from backend.src.derivatives.tts import (
    TTSError,
    TTSProviderNotSupported,
    is_tts_available,
    synthesize_speech,
)
from backend.src.trust import topic_repo
from backend.src.trust.access import ProjectAccessError, require_project_access

router = APIRouter(prefix="/api/v1/derivatives", tags=["derivatives"])
log = get_logger("derivatives")


async def _resolve_key_and_source(
    body: CardRequest | CarouselRequest | AnimatedRequest | AudioRequest,
    request: Request,
    principal: Principal | None,
) -> tuple[str, str, str, str | None]:
    """Resolve the generation key + source text shared by `/card`, `/carousel`,
    and `/animated`.

    `CardRequest`, `CarouselRequest`, and `AnimatedRequest` carry the identical
    key/source shape (`api_key`, `provider_id`, `model`, `source_text`,
    `topic_version_id`), so both the managed/BYOK key-fork and the
    trust-section access seam live here once rather than being copied per
    endpoint. Returns
    `(api_key, model, source_text, source_label)` — `source_label` is the
    version's provenance label (`"Based on N cited source(s)"`) when sourced
    from `topic_version_id`, else `None`. Raises `HTTPException` for every
    key/access failure (400/429 managed; 401/404/403 topic-version), exactly
    as the inline block this replaces did.
    """
    managed = body.api_key is None
    if managed:
        db_pool = getattr(request.app.state, "db", None)
        if db_pool is not None and principal is not None:
            async with db_pool.acquire() as conn:
                account = await accounts_repo.get_or_create_account(
                    conn, idp_sub=principal.sub, email=principal.email
                )
                grant = await access.resolve_managed_access(
                    conn,
                    account_id=account.id,
                    provider_id=body.provider_id,
                    principal=principal,
                )
                if grant is None:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="an api_key is required for this request",
                    )
                if await access.over_cap(conn, account_id=account.id, access=grant):
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="managed allowance exhausted; try again later or add your own key",
                    )
        elif not is_managed_eligible(principal, body.provider_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="an api_key is required for this request",
            )
        api_key = get_managed_key(body.provider_id)
    else:
        api_key = body.api_key

    model = body.model or settings.anthropic_default_model

    # --- source: flat text, or a validated topic-version section (access-gated) ---
    source_text = body.source_text or ""
    source_label: str | None = None
    if body.topic_version_id is not None:
        db_pool = getattr(request.app.state, "db", None)
        if db_pool is None or principal is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="sign in to publish a project section",
            )
        async with db_pool.acquire() as conn:
            project_id = await topic_repo.project_id_for_topic_version(
                conn, topic_version_id=body.topic_version_id
            )
            if project_id is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
            account = await accounts_repo.get_or_create_account(
                conn, idp_sub=principal.sub, email=principal.email
            )
            try:
                await require_project_access(
                    conn, account_id=account.id, project_id=uuid.UUID(str(project_id))
                )
            except ProjectAccessError:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN, "no access to this project"
                ) from None
            tv = await topic_repo.get_topic_version(conn, topic_version_id=body.topic_version_id)
            if tv is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
            sections = (tv.content or {}).get("sections", [])
            source_text = "\n\n".join(
                f"{s.get('heading', '')}\n{s.get('body', '')}" for s in sections
            ).strip()
            cited = {sid for s in sections for sid in (s.get("source_ids") or [])}
            source_label = f"Based on {len(cited)} cited source(s)" if cited else None

    return api_key, model, source_text, source_label


@router.post(
    "/post",
    response_model=DerivativeResponse,
    dependencies=[Depends(enforce_rate_limit)],
)
async def make_post(
    body: DerivativeRequest,
    request: Request,
    principal: Principal | None = Depends(optional_user),
) -> DerivativeResponse:
    """Generate 3 platform-scoped promotional post variants for `body.source_text`.

    Key path (mirrors /generate — ADR-005 D6): a key in the body is BYOK; its
    absence selects the managed path — a DB-backed plan entitlement or the staff
    allowlist grants access (400 if neither, 429 if the grant's cap is already
    spent), same as /generate's `resolve_managed_access` -> `over_cap` fork.
    Runs the (blocking) provider call off the event loop via `asyncio.to_thread`.
    A model that never returns schema-valid JSON within the repair budget
    surfaces as a 502 — never the key.
    """
    # A reference image requires vision — Anthropic-only this slice (FR-1b).
    if body.image is not None and body.provider_id != "anthropic":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="a reference image requires the Anthropic provider",
        )

    managed = body.api_key is None
    if managed:
        db_pool = getattr(request.app.state, "db", None)
        if db_pool is not None and principal is not None:
            async with db_pool.acquire() as conn:
                account = await accounts_repo.get_or_create_account(
                    conn, idp_sub=principal.sub, email=principal.email
                )
                grant = await access.resolve_managed_access(
                    conn,
                    account_id=account.id,
                    provider_id=body.provider_id,
                    principal=principal,
                )
                if grant is None:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="an api_key is required for this request",
                    )
                if await access.over_cap(conn, account_id=account.id, access=grant):
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="managed allowance exhausted; try again later or add your own key",
                    )
        elif not is_managed_eligible(principal, body.provider_id):
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
            image=body.image,
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
                "Your API key was rejected by the provider. Check it in Settings — "
                "it may be invalid, revoked, or out of credit."
            ),
        ) from None
    except LLMRateLimitError:
        log.warning("derivative_rate_limited", platform=body.platform)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="The provider is rate-limiting requests. Wait a moment and try again.",
        ) from None
    except LLMError:
        # Other LLM failure (timeout / transport / unexpected status) — key-free.
        log.warning("derivative_llm_error", platform=body.platform)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="post generation failed",
        ) from None
    except Exception:
        # Defense in depth (mirrors generate/tasks.py): never let a raw exception
        # escape with key material to the framework logger. Type-only log, generic 502.
        log.warning("derivative_unexpected_error", platform=body.platform)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="post generation failed",
        ) from None


@router.post(
    "/card",
    response_model=CardResponse,
    dependencies=[Depends(enforce_rate_limit)],
)
async def make_card(
    body: CardRequest,
    request: Request,
    principal: Principal | None = Depends(optional_user),
) -> CardResponse:
    """Generate a promotional image card (headline + subtext + PNG render).

    Key path is identical to `make_post` (ADR-005 D6): a key in the body is
    BYOK; its absence selects the managed path via `resolve_managed_access` /
    the staff allowlist fallback.

    Source is exactly one of a flat `source_text` or a validated topic-version
    section (`CardRequest._exactly_one_source`). The latter is access-gated:
    the caller must be signed in and hold owner/reviewer/editor access on the
    version's project (`require_project_access`) — a stranger gets 403, a
    missing project/version gets 404. When sourced from a topic version, the
    resulting provenance label (`"Based on N cited source(s)"`) OVERRIDES
    whatever `source_label` the model produced, so the card never claims more
    or less grounding than the version actually has.

    Never logs `api_key` or the section/source content.
    """
    api_key, model, source_text, source_label = await _resolve_key_and_source(
        body, request, principal
    )

    # --- generate + render ---
    try:
        card = await asyncio.to_thread(
            generate_card,
            source_text=source_text,
            size=body.size,
            tone=body.tone,
            provider_id=body.provider_id,
            api_key=api_key,
            model=model,
        )
    except LLMSchemaError:
        log.warning("card_validation_failed", size=body.size)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="could not generate the card",
        ) from None
    except LLMAuthError:
        log.warning("card_auth_rejected", size=body.size)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Your API key was rejected by the provider. Check it in Settings — "
                "it may be invalid, revoked, or out of credit."
            ),
        ) from None
    except LLMRateLimitError:
        log.warning("card_rate_limited", size=body.size)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="The provider is rate-limiting requests. Wait a moment and try again.",
        ) from None
    except LLMError:
        log.warning("card_llm_error", size=body.size)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="card generation failed",
        ) from None
    except Exception:
        # Defense in depth: never let a raw exception escape with key material
        # to the framework logger. Type-only log, generic 502.
        log.warning("card_unexpected_error", size=body.size)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="card generation failed",
        ) from None

    # A validated-section card uses the provenance label, overriding the model's.
    label = source_label if body.topic_version_id is not None else card.source_label
    card_input = {
        "headline": card.headline,
        "subtext": card.subtext,
        "source_label": label,
        "size": body.size,
    }
    try:
        png = await compile_card_png(card_input)
    except CardRenderError:
        log.warning("card_render_error", size=body.size)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="could not render the card image",
        ) from None

    return CardResponse(
        card=CardContent(headline=card.headline, subtext=card.subtext, source_label=label),
        size=body.size,
        image_png_base64=base64.b64encode(png).decode(),
        provenance="ai-generated",
    )


@router.post(
    "/carousel",
    response_model=CarouselResponse,
    dependencies=[Depends(enforce_rate_limit)],
)
async def make_carousel(
    body: CarouselRequest,
    request: Request,
    principal: Principal | None = Depends(optional_user),
) -> CarouselResponse:
    """Generate a promotional image carousel (4-8 frames, each rendered as a PNG).

    Key path and source resolution are identical to `make_card`
    (`_resolve_key_and_source`): a key in the body is BYOK; its absence
    selects the managed path, and `topic_version_id` is access-gated the same
    way (signed-out -> 401, missing -> 404, no project access -> 403).

    Unlike a card, provenance is a carousel-level claim, not a per-frame one:
    when sourced from a topic version, the `"Based on N cited source(s)"`
    label is attached to the LAST frame only — every other frame's
    `source_label` is `None`. The model's own per-frame `source_label` is
    never produced (the carousel contract has no such field) and is ignored
    either way.

    Never logs `api_key` or the frames' headline/subtext content.
    """
    api_key, model, source_text, source_label = await _resolve_key_and_source(
        body, request, principal
    )

    try:
        frames = await asyncio.to_thread(
            generate_carousel,
            source_text=source_text,
            tone=body.tone,
            provider_id=body.provider_id,
            api_key=api_key,
            model=model,
        )
    except LLMSchemaError:
        log.warning("carousel_validation_failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="could not generate the carousel",
        ) from None
    except LLMAuthError:
        log.warning("carousel_auth_rejected")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Your API key was rejected by the provider. Check it in Settings — "
                "it may be invalid, revoked, or out of credit."
            ),
        ) from None
    except LLMRateLimitError:
        log.warning("carousel_rate_limited")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="The provider is rate-limiting requests. Wait a moment and try again.",
        ) from None
    except LLMError:
        log.warning("carousel_llm_error")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="carousel generation failed",
        ) from None
    except Exception:
        # Defense in depth: never let a raw exception escape with key material
        # to the framework logger. Type-only log, generic 502.
        log.warning("carousel_unexpected_error")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="carousel generation failed",
        ) from None

    # A validated-section carousel puts the provenance label on the LAST frame
    # only — the model never produces a per-frame source_label to override.
    n = len(frames)
    card_inputs = [
        {
            "headline": f.headline,
            "subtext": f.subtext,
            "source_label": (
                source_label if (body.topic_version_id is not None and i == n - 1) else None
            ),
            "size": "square",
        }
        for i, f in enumerate(frames)
    ]
    try:
        pngs = await compile_carousel_png(card_inputs)
    except CardRenderError:
        log.warning("carousel_render_error")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="could not render the carousel",
        ) from None

    out_frames = [
        CarouselFrame(
            card=CardContent(
                headline=ci["headline"], subtext=ci["subtext"], source_label=ci["source_label"]
            ),
            image_png_base64=base64.b64encode(png).decode(),
        )
        for ci, png in zip(card_inputs, pngs, strict=True)
    ]
    return CarouselResponse(frames=out_frames, provenance="ai-generated")


@router.post(
    "/animated",
    response_model=AnimatedResponse,
    dependencies=[Depends(enforce_rate_limit)],
)
async def make_animated(
    body: AnimatedRequest,
    request: Request,
    principal: Principal | None = Depends(optional_user),
) -> AnimatedResponse:
    """Generate an animated promotional card (headline + subtext + GIF render).

    Key path and source resolution are identical to `make_card`
    (`_resolve_key_and_source`): a key in the body is BYOK; its absence
    selects the managed path, and `topic_version_id` is access-gated the same
    way (signed-out -> 401, missing -> 404, no project access -> 403).

    The copy is generated via the same `generate_card` call as `/card` (fixed
    "square" size) — no separate generator. `preset` only steers the
    compiler's `--format animated` animation, not the copy.

    Never logs `api_key` or the section/source content.
    """
    api_key, model, source_text, source_label = await _resolve_key_and_source(
        body, request, principal
    )

    # --- generate + render ---
    try:
        card = await asyncio.to_thread(
            generate_card,
            source_text=source_text,
            size="square",
            tone=body.tone,
            provider_id=body.provider_id,
            api_key=api_key,
            model=model,
        )
    except LLMSchemaError:
        log.warning("animated_validation_failed", preset=body.preset)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="could not generate the card copy",
        ) from None
    except LLMAuthError:
        log.warning("animated_auth_rejected", preset=body.preset)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Your API key was rejected by the provider. Check it in Settings — "
                "it may be invalid, revoked, or out of credit."
            ),
        ) from None
    except LLMRateLimitError:
        log.warning("animated_rate_limited", preset=body.preset)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="The provider is rate-limiting requests. Wait a moment and try again.",
        ) from None
    except LLMError:
        log.warning("animated_llm_error", preset=body.preset)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="card generation failed",
        ) from None
    except Exception:
        # Defense in depth: never let a raw exception escape with key material
        # to the framework logger. Type-only log, generic 502.
        log.warning("animated_unexpected_error", preset=body.preset)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="card generation failed",
        ) from None

    # A validated-section card uses the provenance label, overriding the model's.
    label = source_label if body.topic_version_id is not None else card.source_label
    card_input = {
        "headline": card.headline,
        "subtext": card.subtext,
        "source_label": label,
        "preset": body.preset,
        "size": "square",
    }
    try:
        gif = await compile_animated_gif(card_input)
    except CardRenderError:
        log.warning("animated_render_error", preset=body.preset)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="could not render the animated card",
        ) from None

    return AnimatedResponse(
        card=CardContent(headline=card.headline, subtext=card.subtext, source_label=label),
        preset=body.preset,
        image_gif_base64=base64.b64encode(gif).decode(),
        provenance="ai-generated",
    )


@router.post(
    "/audio",
    response_model=AudioResponse,
    dependencies=[Depends(enforce_rate_limit)],
)
async def make_audio(
    body: AudioRequest,
    request: Request,
    principal: Principal | None = Depends(optional_user),
) -> AudioResponse:
    """Generate a narrated audio clip (a spoken-summary script + MP3 render).

    Pipeline mirrors `make_card` minus the compiler: resolve key/source via
    `_resolve_key_and_source` (identical managed/BYOK fork + trust-section
    access gate), generate a speakable narration script via the LLM seam
    (`generate_narration`), then synthesize it via a SEPARATE TTS client
    (`synthesize_speech` — the LLM seam is chat-only, no TTS capability).

    `body.provider_id` must be TTS-capable AND the feature must be
    configured (`is_tts_available`) — checked FIRST, before any key
    resolution or LLM call, so an unsupported/disabled provider fails fast
    with a clean 422 and no wasted spend. Managed spend (character count ->
    cost) is metered once, on success only, on the managed path.

    Never logs `api_key` or the script content.
    """
    if not is_tts_available(body.provider_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"audio narration is not available for {body.provider_id}",
        )

    api_key, model, source_text, _source_label = await _resolve_key_and_source(
        body, request, principal
    )
    # _resolve_key_and_source falls back to settings.anthropic_default_model
    # when body.model is omitted, regardless of provider_id — wrong here
    # since AudioRequest defaults to the TTS-only "openai" provider. Re-
    # resolve the registry's OWN default model when the caller pinned none.
    if body.model is None and body.provider_id != "anthropic":
        model = PROVIDER_REGISTRY[body.provider_id].default_model

    try:
        narration = await asyncio.to_thread(
            generate_narration,
            source_text=source_text,
            tone=body.tone,
            provider_id=body.provider_id,
            api_key=api_key,
            model=model,
        )
    except LLMSchemaError:
        log.warning("audio_validation_failed", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="could not generate the narration script",
        ) from None
    except LLMAuthError:
        log.warning("audio_auth_rejected", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Your API key was rejected by the provider. Check it in Settings — "
                "it may be invalid, revoked, or out of credit."
            ),
        ) from None
    except LLMRateLimitError:
        log.warning("audio_rate_limited", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="The provider is rate-limiting requests. Wait a moment and try again.",
        ) from None
    except LLMError:
        log.warning("audio_llm_error", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="narration generation failed",
        ) from None
    except Exception:
        # Defense in depth: never let a raw exception escape with key material
        # to the framework logger. Type-only log, generic 502.
        log.warning("audio_unexpected_error", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="narration generation failed",
        ) from None

    try:
        audio_bytes, char_count = await synthesize_speech(
            narration.script,
            provider_id=body.provider_id,
            api_key=api_key,
            voice=body.voice,
        )
    except TTSProviderNotSupported:
        log.warning("audio_tts_not_supported", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"audio narration is not available for {body.provider_id}",
        ) from None
    except TTSError:
        log.warning("audio_tts_failed", provider_id=body.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="could not synthesize audio",
        ) from None

    # Meter managed spend (char_count -> cost) on success only, managed path
    # only — best-effort, mirrors generate/tasks.py's _record_managed_usage.
    if body.api_key is None:
        db_pool = getattr(request.app.state, "db", None)
        if db_pool is not None and principal is not None:
            try:
                async with db_pool.acquire() as conn:
                    account = await accounts_repo.get_or_create_account(
                        conn, idp_sub=principal.sub, email=principal.email
                    )
                    cost = pricing.tts_cost_micros(body.provider_id, char_count)
                    await usage_repo.record_usage(
                        conn,
                        account_id=account.id,
                        provider=body.provider_id,
                        model=f"tts:{body.voice or 'default'}",
                        input_tokens=0,
                        output_tokens=char_count,
                        cost_micros=cost,
                        job_id=uuid.uuid4(),
                    )
                log.info("audio_usage_recorded", cost_micros=cost)
            except Exception:
                # Counts/cost only — no key, no content — so a warning is
                # safe, and metering never fails a clip the user already got.
                log.warning("audio_usage_record_failed")

    return AudioResponse(
        script=narration.script,
        title=narration.title,
        audio_base64=base64.b64encode(audio_bytes).decode(),
        mime="audio/mpeg",
        provenance="ai-generated",
    )
