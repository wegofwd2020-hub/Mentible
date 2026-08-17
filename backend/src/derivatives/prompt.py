"""Prompt construction for platform-scoped social-media derivative posts.

Unlike `prompt_builder.build_lesson_prompt` (teach a topic) or
`quiz_prompt.build_quiz_prompt` (quiz a passage), this asks the model to write
promotional posts for a platform (LinkedIn / X) that market the supplied
source material — ADR-037 D8. The posts must not invent facts beyond the
source; they market it, they do not extend it.

Output JSON schema is validated by `schemas._DerivativeOutput`. Keep the field
set there in sync with the schema example below.
"""

from __future__ import annotations

_PLATFORM_RULES = {
    "linkedin": "Professional but human. Each post <= 3000 characters. 3-5 relevant hashtags. End with a clear call to action.",
    "x": "Punchy. Each post (the body) <= 280 characters. 1-2 hashtags. No fluff.",
}


def build_derivative_prompt(
    source_text: str, platform: str, tone: str | None = None, has_reference: bool = False
) -> str:
    """Return the prompt for generating platform-scoped promotional post variants.

    Output is JSON conforming to `schemas._DerivativeOutput`.
    """
    rules = _PLATFORM_RULES.get(platform, _PLATFORM_RULES["linkedin"])
    tone_line = f"\nTone: {tone}." if tone else ""
    reference_line = (
        "A reference image is attached. Take ONLY stylistic and structural "
        "guidance from it — tone, layout, pacing, energy. Do NOT describe, "
        "transcribe, or reproduce the image, and do not treat it as a source of "
        "facts. The post content comes ONLY from the source material above.\n\n"
        if has_reference
        else ""
    )
    return (
        f"You are a social-media editor. Using ONLY the source material below, write 3 distinct "
        f"{platform} posts that PROMOTE it. Do not invent facts beyond the source; the posts market "
        f"the source, they do not add claims.{tone_line}\n\n"
        f"Platform rules: {rules}\n\n"
        f'SOURCE:\n"""\n{source_text}\n"""\n\n{reference_line}Respond with ONLY valid JSON, no prose, exactly matching this schema:\n'
        f'{{"variants": [{{"hook": "string", "body": "string", "hashtags": ["#tag"], "cta": "string or null"}}]}}\n'
        f"Return exactly 3 variants."
    )


_CARD_SIZE_RULES = {
    # Portrait — the tallest canvas of the three, so subtext can run a touch
    # longer without crowding the card.
    "story": "This is a tall PORTRAIT card (story format). Subtext may use the fuller end of the range, up to 2 short lines.",
    # Short, wide landscape — least vertical room, so keep subtext tight.
    "linkedin": "This is a short, wide LANDSCAPE card (LinkedIn format). Keep subtext tight and to one line where possible.",
    # Balanced default.
    "square": "This is a balanced SQUARE card. Keep subtext to one or two short lines.",
}


def build_card_prompt(source_text: str, size: str, tone: str | None) -> str:
    """Return the prompt for generating a single promotional image-card's copy.

    Output is JSON conforming to `schemas.CardContent`. Unlike
    `build_derivative_prompt` (3 platform posts), this produces one short
    headline + subtext pair meant to sit on top of a rendered image card —
    PROMOTE the source, invent nothing beyond it. `size` nudges subtext length
    to fit the card's aspect ratio (see `_CARD_SIZE_RULES`); the headline <= 60
    character rule is unchanged across sizes.
    """
    tone_line = f"Tone: {tone}.\n" if tone else ""
    size_line = _CARD_SIZE_RULES.get(size, _CARD_SIZE_RULES["square"])
    return (
        "You write a short, punchy quote/summary CARD that PROMOTES the source below. "
        "Invent nothing beyond the source.\n"
        f"{size_line}\n"
        f"{tone_line}"
        'Return ONLY JSON: {"headline": string, "subtext": string, "source_label": string|null}.\n'
        "headline: <= 60 characters, a hook. subtext: <= 160 characters, one or two lines. "
        "source_label: null (the caller may override it).\n\n"
        f'SOURCE:\n"""\n{source_text}\n"""'
    )
