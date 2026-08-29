"""LLM source-overlap originality check (B3 Part A) — per section, ask
whether the section's text reproduces ONLY its own cited sources verbatim,
paraphrases them closely, or is synthesized in the author's own words.
Explicitly NOT an against-the-web plagiarism scan (the LLM seam is
model-only and cannot search the web — see the design spec's "Why"). Reuses
the generate.py conformance loop exactly as grounding.py does; the caller
(tasks.py) resolves the key and persists the result."""

from __future__ import annotations

from pydantic import BaseModel

from .generate import (
    LLMRequest,
    build_provider,
    cap_max_tokens,
    generate_validated,
    parse_json_response,
)

_MAX_TOKENS = 8192
_MAX_REPAIRS = 2
_OVERLAPS = {"none", "paraphrase", "verbatim"}


class _OriginalityOut(BaseModel):
    overlap: str
    note: str | None = None
    source_ref: str | None = None


def build_originality_prompt(heading: str, body: str, cited: list[tuple[str, str]]) -> str:
    src = "\n\n".join(f'[{label}]\n"""\n{content}\n"""' for label, content in cited)
    return (
        "You are checking whether a section closely reproduces its OWN cited sources — "
        "NOT checking the whole internet, ONLY the sources listed below.\n"
        f"SECTION: {heading}\n\nSOURCES (cite ONLY these labels):\n{src}\n\n"
        f'SECTION TEXT:\n"""\n{body}\n"""\n\n'
        "Decide whether the section text reproduces a cited source verbatim or near-verbatim "
        "(word-for-word, or with only trivial changes), is a paraphrase that stays close to the "
        "source's phrasing/structure, or is synthesized in the author's own words (no meaningful "
        "overlap). Classify the WHOLE section as exactly one of 'verbatim', 'paraphrase', or 'none'. "
        "If 'verbatim' or 'paraphrase', name the ONE source label it overlaps most and give a "
        "one-line reason.\n"
        'Return ONLY JSON: {"overlap":"none|paraphrase|verbatim","note":"<one line or null>",'
        '"source_ref":"<a source label like S1, or null>"}'
    )


def _coerce(data) -> _OriginalityOut:
    out = _OriginalityOut.model_validate(data)
    if out.overlap not in _OVERLAPS:
        # Fail-safe: an unparseable verdict surfaces for human review rather
        # than silently passing as clean — mirrors grounding._coerce
        # normalizing an unknown claim status to "unsupported" (the state
        # that demands attention, not the state that waves it through).
        out.overlap = "verbatim"
    return out


def _source_content(sources, sid: str) -> str:
    for s in sources:
        if str(s.id) == sid:
            return s.content or ""
    return ""


def generate_originality(
    *, sections, sources, provider_id, api_key, model
) -> tuple[dict, int, int]:
    """Per section, classify whether it overlaps ONLY that section's cited
    sources as 'none' | 'paraphrase' | 'verbatim'. A section citing no live
    source (or with an empty body) is 'none' with no LLM call — there is
    nothing to compare it against.

    Returns `(report, input_tokens, output_tokens)` — the token totals are
    summed across every per-section `generate_validated` call (sections that
    skip the LLM call contribute 0), for the caller to meter managed usage —
    same contract as grounding.generate_grounding."""
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    id_to_label = {v: k for k, v in by_label.items()}
    out_sections: list[dict] = []
    totals = {"verbatim": 0, "paraphrase": 0, "clean": 0}
    input_tokens = 0
    output_tokens = 0

    for idx, sec in enumerate(sections):
        heading = sec.get("heading") or ""
        body = sec.get("body") or ""
        live_ids = [sid for sid in (sec.get("source_ids") or []) if sid in id_to_label]
        if not live_ids or not body.strip():
            overlap, note, source_ref = "none", None, None
        else:
            cited = [(id_to_label[sid], _source_content(sources, sid)) for sid in live_ids]
            provider = build_provider(provider_id, api_key=api_key, model=model)
            op = build_originality_prompt(heading, body, cited)
            req = LLMRequest(
                prompt=op,
                max_tokens=cap_max_tokens(provider_id, _MAX_TOKENS, prompt=op),
                response_format="json",
            )

            def _validate(text: str) -> _OriginalityOut:
                return _coerce(parse_json_response(text))

            res = generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS)
            input_tokens += res.total_input_tokens
            output_tokens += res.total_output_tokens
            overlap = res.parsed.overlap
            note = res.parsed.note
            label = res.parsed.source_ref
            source_ref = by_label.get(label) if label in by_label else None

        summary_key = "clean" if overlap == "none" else overlap
        totals[summary_key] = totals.get(summary_key, 0) + 1
        out_sections.append(
            {
                "index": idx,
                "heading": heading,
                "overlap": overlap,
                "note": note,
                "source_ref": source_ref,
            }
        )

    report = {
        "sections": out_sections,
        "summary": {
            "verbatim": totals["verbatim"],
            "paraphrase": totals["paraphrase"],
            "clean": totals["clean"],
            "total": len(out_sections),
        },
    }
    return report, input_tokens, output_tokens
