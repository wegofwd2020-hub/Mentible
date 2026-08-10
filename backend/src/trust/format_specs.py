"""Per-format generation specs for the trust draft generator (drafts multi-format picker).

One unified generator; the spec varies the prompt's length/section rules per artifact
format. Content shape stays {sections} for every format (see the design spec).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FormatSpec:
    section_rule: str  # the "write N sections" framing injected into the prompt
    rules: str  # length + style rules for this format
    # Long-form written formats (book, essay) may include grounded diagrams;
    # social/spoken formats (post, thread, reel, podcast) never do.
    supports_diagrams: bool = False


FORMAT_SPECS: dict[str, FormatSpec] = {
    "linkedin": FormatSpec(
        "Write ONE LinkedIn post as a single section (leave the heading empty).",
        "180-260 words. Professional but human. 3-5 relevant hashtags. End with a clear call to action.",
    ),
    "x_thread": FormatSpec(
        "Write ONE X thread as a single section; put 5 to 8 tweets in the body, each on its own line.",
        "Each tweet <= 280 characters. Punchy, no fluff. 1-2 hashtags total.",
    ),
    "reel": FormatSpec(
        "Write ONE ~60-second reel script as a single section.",
        "A hook, 2-3 beats, and a close. Spoken, energetic.",
    ),
    "podcast": FormatSpec(
        "Write ONE 60-90 second podcast cold-open monologue as a single section.",
        "Conversational, draws the listener in.",
    ),
    "essay": FormatSpec(
        "Write a long-form essay across 3 to 5 sections, each with a heading.",
        "800-1200 words total. Clear prose.",
        supports_diagrams=True,
    ),
    "book": FormatSpec(
        "write a short draft of 3 to 6 sections",
        "",
        supports_diagrams=True,
    ),
}

DEFAULT_SPEC = FORMAT_SPECS["book"]
