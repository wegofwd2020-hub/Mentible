"""LLM claim-grounding (P1-4) — per section, split the body into sentence-level
claims and label each supported/partial/unsupported against ONLY that section's
cited sources. Reuses the generate.py conformance loop; the caller (tasks.py)
resolves the key and persists the result. Mirrors generate.py's imports."""

from __future__ import annotations

from pydantic import BaseModel, Field

from .generate import (
    LLMRequest,
    build_provider,
    cap_max_tokens,
    generate_validated,
    parse_json_response,
)

_MAX_TOKENS = 8192
_MAX_REPAIRS = 2
_STATUSES = {"supported", "partial", "unsupported"}


class _Claim(BaseModel):
    text: str
    status: str
    sources: list[str] = Field(default_factory=list)


class _GroundingOut(BaseModel):
    claims: list[_Claim]


def build_grounding_prompt(heading: str, body: str, cited: list[tuple[str, str]]) -> str:
    src = "\n\n".join(f'[{label}]\n"""\n{content}\n"""' for label, content in cited)
    return (
        "You are auditing whether a section's claims are supported by its cited sources.\n"
        f"SECTION: {heading}\n\nSOURCES (cite ONLY these labels):\n{src}\n\n"
        f'SECTION TEXT:\n"""\n{body}\n"""\n\n'
        "Split the section text into individual sentence-level claims. For EACH claim, decide if the "
        "sources support it: 'supported' (a source states it), 'partial' (related but not fully stated), "
        "or 'unsupported' (no source states it). List the supporting source label(s).\n"
        'Return ONLY JSON: {"claims":[{"text":"<sentence>","status":"supported|partial|unsupported",'
        '"sources":["S1"]}]}'
    )


def _coerce(data) -> _GroundingOut:
    out = _GroundingOut.model_validate(data)
    for c in out.claims:
        if c.status not in _STATUSES:
            c.status = "unsupported"
    return out


def _source_content(sources, sid: str) -> str:
    for s in sources:
        if str(s.id) == sid:
            return s.content or ""
    return ""


def generate_grounding(*, sections, sources, provider_id, api_key, model) -> tuple[dict, int, int]:
    """Per section, split the body into sentence-level claims and label each
    supported/partial/unsupported against ONLY that section's cited sources.
    A section citing no live source (or with an empty body) is entirely
    `unsupported` with no LLM call. No I/O, no persistence — the caller
    (tasks.py) resolves the key and stores the result.

    Returns `(report, input_tokens, output_tokens)` — the token totals are
    summed across every per-section `generate_validated` call (sections that
    skip the LLM call contribute 0) so the caller can meter managed usage
    (P1-4 T4 fix round 1). Not folded into `report` itself: T3's report-shape
    test asserts the dict's key set with `==`, so widening it would be a
    breaking change to an already-committed contract."""
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    id_to_label = {v: k for k, v in by_label.items()}
    by_section: list[dict] = []
    totals = {"supported": 0, "partial": 0, "unsupported": 0}
    input_tokens = 0
    output_tokens = 0

    for idx, sec in enumerate(sections):
        body = sec.get("body") or ""
        live_ids = [sid for sid in (sec.get("source_ids") or []) if sid in id_to_label]
        if not live_ids or not body.strip():
            # No cited source (or empty body) → every sentence is unsupported,
            # no LLM call, no tokens spent.
            claims = (
                [{"text": body.strip(), "status": "unsupported", "source_ids": []}]
                if body.strip()
                else []
            )
        else:
            cited = [(id_to_label[sid], _source_content(sources, sid)) for sid in live_ids]
            provider = build_provider(provider_id, api_key=api_key, model=model)
            gp = build_grounding_prompt(sec.get("heading") or "", body, cited)
            req = LLMRequest(
                prompt=gp,
                max_tokens=cap_max_tokens(provider_id, _MAX_TOKENS, prompt=gp),
                response_format="json",
            )

            def _validate(text: str) -> _GroundingOut:
                return _coerce(parse_json_response(text))

            res = generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS)
            input_tokens += res.total_input_tokens
            output_tokens += res.total_output_tokens
            claims = [
                {
                    "text": c.text,
                    "status": c.status,
                    "source_ids": [by_label[label] for label in c.sources if label in by_label],
                }
                for c in res.parsed.claims
            ]
        for c in claims:
            totals[c["status"]] = totals.get(c["status"], 0) + 1
        by_section.append({"section_index": idx, "claims": claims})

    report = {
        "claims_total": sum(totals.values()),
        "supported": totals["supported"],
        "partial": totals["partial"],
        "unsupported": totals["unsupported"],
        "by_section": by_section,
        "model": model,
    }
    return report, input_tokens, output_tokens
