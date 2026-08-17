"""Deterministic per-version quality analysis (P1-4) — pure, no LLM, no I/O.

Two facts about a trust version, computed from its `content.sections` and the
project's LIVE input ids:
  - coverage: how many sections cite a source that still exists (uncited /
    dangling flagged) — reads the model-declared `source_ids` already on each
    section; it does NOT verify claims (that's the LLM tier, grounding.py).
  - readability: Flesch reading-ease + Flesch-Kincaid grade over the prose.
"""

from __future__ import annotations

import re


def coverage_report(sections: list[dict], live_input_ids: set[str]) -> dict:
    """Analyze which sections cite live inputs, and flag uncited/dangling refs.

    Args:
        sections: list of section dicts, each with 'source_ids' key
        live_input_ids: set of IDs that currently exist in the project

    Returns:
        dict with keys:
          - sections_total: count of all sections
          - sections_cited: count of sections with at least one live source
          - uncited_section_indexes: list of section indices with no live sources
          - dangling: list of {"section_index": i, "source_id": sid} for refs to gone sources
          - source_refs: count of unique live source IDs referenced
    """
    uncited: list[int] = []
    dangling: list[dict] = []
    cited_ids: set[str] = set()
    for i, sec in enumerate(sections):
        ids = sec.get("source_ids") or []
        live = [sid for sid in ids if sid in live_input_ids]
        cited_ids.update(live)
        if not live:
            uncited.append(i)
        for sid in ids:
            if sid not in live_input_ids:
                dangling.append({"section_index": i, "source_id": sid})
    return {
        "sections_total": len(sections),
        "sections_cited": len(sections) - len(uncited),
        "uncited_section_indexes": uncited,
        "dangling": dangling,
        "source_refs": len(cited_ids),
    }


_FENCE = re.compile(r"```.*?```", re.DOTALL)          # code / mermaid fences
_MATH = re.compile(r"\${1,2}[^$]*\${1,2}")            # $…$ / $$…$$
_MD = re.compile(r"[#*_>`\[\]()!~|-]")                 # markdown punctuation
_WORD = re.compile(r"[A-Za-z][A-Za-z'-]*")
_SENT = re.compile(r"[.!?]+")


def _syllables(word: str) -> int:
    """Count syllables in a word using vowel groups (standard Flesch method)."""
    w = word.lower()
    groups = re.findall(r"[aeiouy]+", w)
    n = len(groups)
    if w.endswith("e") and n > 1:        # silent trailing 'e'
        n -= 1
    return max(1, n)


def readability(text: str) -> dict:
    """Compute Flesch Reading Ease and Flesch-Kincaid Grade Level.

    Strips code fences, math, and markdown punctuation before counting.
    Guards against divide-by-zero (0 sentences or 0 words → all-zero scores).

    Args:
        text: raw markdown/text string

    Returns:
        dict with keys:
          - flesch_reading_ease: float (0–100+; higher = easier)
          - grade_level: float (0+; US school grade equivalent)
          - words: int (total word count)
          - sentences: int (total sentence count)
    """
    clean = _MD.sub(" ", _MATH.sub(" ", _FENCE.sub(" ", text or "")))
    words = _WORD.findall(clean)
    sentences = max(0, len([s for s in _SENT.split(clean) if s.strip()]))
    n_words, n_sent = len(words), sentences
    if n_words == 0 or n_sent == 0:
        return {"flesch_reading_ease": 0.0, "grade_level": 0.0, "words": n_words, "sentences": n_sent}
    syl = sum(_syllables(w) for w in words)
    wps, spw = n_words / n_sent, syl / n_words
    ease = 206.835 - 1.015 * wps - 84.6 * spw
    grade = 0.39 * wps + 11.8 * spw - 15.59
    return {
        "flesch_reading_ease": round(ease, 1),
        "grade_level": round(max(0.0, grade), 1),
        "words": n_words,
        "sentences": n_sent,
    }


def version_quality(sections: list[dict], live_input_ids: set[str]) -> dict:
    """Bundle coverage and readability analysis for a version.

    Args:
        sections: list of section dicts
        live_input_ids: set of live source IDs in the project

    Returns:
        dict with keys:
          - coverage: result of coverage_report()
          - readability: result of readability() over all section bodies
    """
    body = "\n\n".join(s.get("body") or "" for s in sections)
    return {"coverage": coverage_report(sections, live_input_ids), "readability": readability(body)}
