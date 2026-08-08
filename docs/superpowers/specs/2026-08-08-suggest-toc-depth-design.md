# Deeper Suggest-TOC — design

**Status:** Approved (brainstorming, 2026-08-08). Follow-up to Slice B (Structure phase,
`docs/superpowers/specs/2026-08-07-slice-b-structure-toc-design.md`). Addresses Sridhar #3
(chapter/outline comes out thin).

## Problem

"Suggest from sources" on the Structure phase returns a **flat** outline — `subjects → topics`,
each topic just a `title`. The schema (`toc_suggest.py` `_TocTopic{title, sources}`) has no
subtopics, and the prompt actively hedges toward sparseness ("if the sources are thin, propose few
topics"). The editor's `TopicNode` already supports `subtopics`, so the depth is renderable — the
generator just never produces it. Result: outlines feel thin and under-use the source material.

## Goal

A **deeper, better-attributed** suggested outline — subjects → topics → **subtopics** — grounded in
what the sources actually cover, with each subtopic optionally carrying a one-line detail. No new
mobile UI (the editor already renders/edits subtopics). Independent of feeding the TOC into
generation (that stays Slice C).

## Decisions (brainstorming 2026-08-08)

1. **Subtopics per topic**, shape = **model chooses**: each subtopic has a `label` and an OPTIONAL
   one-line `detail` — the model adds `detail` where the sources support a concrete gloss, leaves it
   empty (label-only) otherwise. Mixed output is expected and fine.
2. **Source attribution stays per-topic** (not per-subtopic) — keeps the mapping simple.
3. **Drop the "propose few topics" hedge**; keep "invent nothing beyond the sources" (grounding is
   unchanged — this deepens coverage of what's there, it does not invent).
4. **Backend-only.** Mobile needs no change: the client's `toSubtopics` mapper already handles
   `string | {label} | {label,detail}`, and `TopicTreeEditor` already renders subtopic chips.
5. `max_tokens` 2048 → 4096 for the richer output.

## Architecture

### Backend (`backend/src/trust/`)

**Schema (`toc_suggest.py`):**
```python
class _TocSubtopic(BaseModel):
    label: str
    detail: str | None = None

class _TocTopic(BaseModel):
    title: str
    subtopics: list[_TocSubtopic] = Field(default_factory=list, max_length=12)
    sources: list[str] = []

class _TocSubject(BaseModel):
    subject_label: str
    topics: list[_TocTopic] = Field(min_length=1, max_length=8)

class _TocOutput(BaseModel):
    subjects: list[_TocSubject] = Field(min_length=1, max_length=6)
```
`_MAX_TOKENS = 4096`.

**Prompt (`toc_prompt.py`):** keep the `[S1]..[Sn]` source labelling + "use ONLY the sources /
invent nothing" discipline. Change the instruction to:
- propose 1–6 subjects, each with 1–8 topics;
- **for each topic, break it into the concrete subtopics the sources actually cover** — be thorough,
  include the sub-points the sources discuss, don't collapse to a bare title;
- **give a subtopic a short one-line `detail` when the sources support a concrete gloss; otherwise
  leave `detail` empty (label only)**;
- attribute each topic to the source label(s) it draws from;
- invent nothing beyond the sources.
- Remove the "if the sources are thin, propose few topics" line.
- Update the embedded JSON schema example to the new shape (subtopics with optional detail).

**Endpoint (`router.py` `suggest_project_toc`, ~line 620):** map each topic's `subtopics` through
instead of hardcoding `[]`. Each `_TocSubtopic` → `{label, detail}` when `detail` is a non-empty
string, else the bare `label` string (matching the `Subtopic = string | {label,detail}` union the
client + editor expect):
```python
"subtopics": [
    ({"label": st.label, "detail": st.detail} if st.detail else st.label)
    for st in t.subtopics
],
```
`by_label` source→id mapping, `id`/`prerequisites`, owner-only auth, and the LLM error mapping are
UNCHANGED.

### Mobile

No change. Verify (test) that a suggested topic carrying subtopics renders them in `TopicTreeEditor`
via the existing `tocViewToStructured`/`toSubtopics` path — the wire `subtopics: (string|object)[]`
already flows into the editor.

## Data flow

```
Suggest → grounded LLM → subjects[].topics[].subtopics[] (label + optional detail) + S-labels
  → endpoint maps S→input ids AND subtopics→(string | {label,detail})
  → StructuredTOC (topics now carry real subtopics) → fills TopicTreeEditor (renders + editable)
  → user edits → PUT /toc persists verbatim
```

## Error handling

Unchanged from Slice B: no sources → 422; LLM failure → 502; a hallucinated source label is dropped
(`if lbl in by_label`); malformed model output retried (`max_repairs=2`) then 502. A subtopic with an
empty/whitespace detail maps to a bare label (no empty-detail objects leak through).

## Testing

**Backend (pytest, mocked LLM):**
- `build_toc_prompt`: includes the subtopic + thoroughness instruction, the "detail when supported"
  guidance, `[S1]` labels, "invent nothing"; the "propose few" hedge is gone; JSON schema example
  shows subtopics.
- `suggest_toc`: parses a mocked response with topics that have subtopics (some with detail, some
  bare); `_TocOutput` validates; `max_length` bounds hold.
- Endpoint: a mocked suggestion with subtopics → the returned `toc` units carry `subtopics` as a mix
  of bare strings and `{label,detail}` objects, mapped correctly; `source_ids` still map S→ids;
  no-sources 422; reviewer 403; key never in response (ADR-001, keep the existing assertion).

**Mobile (Jest + RNTL):**
- `tocViewToStructured` maps a wire topic with `subtopics: ["a", {label:"b",detail:"d"}]` to the
  editor's `Subtopic[]` without loss (extend the existing mapper test if present).
- StructurePanel/`TopicTreeEditor`: a suggested topic with subtopics renders its subtopic chips
  (spot check via the existing structure test's suggest path — the mocked `suggestToc` returns a
  topic with subtopics; assert a subtopic label renders).

## Files

**Backend:** `src/trust/toc_suggest.py` (schema + max_tokens), `src/trust/toc_prompt.py` (prompt),
`src/trust/router.py` (subtopics mapping). Tests: `backend/tests/test_trust_toc.py`,
`backend/tests/test_trust_router.py`.
**Mobile:** tests only — `mobile/__tests__/screens/TrustProjectDetail.structure.test.tsx` and/or the
`tocViewToStructured` mapper test. No app-code change expected.

## Rollout

**Backend behavior change (no DB migration)** → **prod backend refresh** on ship (new prompt/schema
change the `/suggest-toc` output). **No web redeploy required** — the mobile mapper/editor already
handle subtopics (shipped). No APK rebuild needed for the change to take effect (server-driven).

## Out of scope

Feeding the TOC into draft generation + per-topic validation (Slice C). Per-subtopic source
attribution. Any Structure-phase UI change.
