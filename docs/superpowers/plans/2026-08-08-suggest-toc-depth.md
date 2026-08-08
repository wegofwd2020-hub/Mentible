# Deeper Suggest-TOC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Suggest from sources" return a deeper outline — subjects → topics → **subtopics** (label + optional detail) — grounded in the sources, dropping the sparseness hedge.

**Architecture:** Backend-only. Extend the suggest schema + prompt (`toc_suggest.py`/`toc_prompt.py`), map subtopics through in the endpoint (`router.py`, today hardcodes `subtopics: []`). Mobile already renders subtopics — a test confirms the wire→editor mapping is lossless.

**Tech Stack:** FastAPI + pydantic + `wegofwd_llm`; pytest (mocked LLM); mobile Jest/RNTL.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-08-suggest-toc-depth-design.md`.
- Grounding UNCHANGED: keep "use ONLY the sources / invent nothing"; this deepens coverage of what's there, never invents. Keep `[S1]..[Sn]` source labelling + per-topic attribution.
- Subtopic shape = **model chooses**: `{label, detail?}`; endpoint emits `{label,detail}` when detail is a non-empty string, else the bare `label` string (the `Subtopic = string | {label,detail}` union the client/editor expect). No empty-detail objects leak through.
- ADR-001: the LLM api key never touches a log line / response / traceback — keep the existing `assert key not in r.text` suggest-toc test.
- Owner-only suggest (reviewer 403); no-sources 422; LLM failure 502; hallucinated label dropped (`if lbl in by_label`). All unchanged.
- Pre-push: `ruff format --check backend/ pipeline/` + `ruff check` from repo root; `npx tsc --noEmit` for any mobile test change.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Backend — subtopics in the suggest schema, prompt, and endpoint

**Files:**
- Modify: `backend/src/trust/toc_suggest.py`, `backend/src/trust/toc_prompt.py`, `backend/src/trust/router.py`
- Test: `backend/tests/test_trust_toc.py`, `backend/tests/test_trust_router.py`

**Interfaces:**
- Produces: `_TocSubtopic{label:str, detail:str|None}`; `_TocTopic` gains `subtopics: list[_TocSubtopic]`; the `/suggest-toc` response `toc.subjects[].units[].subtopics` now carries a mix of bare strings and `{label,detail}` objects.

- [ ] **Step 1: Write the failing tests.**

Add to `backend/tests/test_trust_toc.py` (prompt is pure):
```python
def test_toc_prompt_asks_for_subtopics_and_drops_sparse_hedge():
    p = build_toc_prompt(_SOURCES, "stormwater", "engineers", "size pipes")
    assert "subtopic" in p.lower()
    assert "invent nothing" in p.lower()          # grounding kept
    assert "propose few" not in p.lower()          # hedge removed
    assert "detail" in p.lower()                    # optional-detail guidance present
    assert "subtopics" in p                         # schema example updated
```
Add an endpoint test to `backend/tests/test_trust_router.py` (mirror the existing suggest-toc test's mocked-provider setup): mock the provider to return a suggestion whose topic has `subtopics: [{"label":"A","detail":"d"},{"label":"B"}]`, POST `/suggest-toc`, and assert the returned `toc.subjects[0].units[0].subtopics == [{"label":"A","detail":"d"}, "B"]` (object with detail, bare string without). Keep the existing no-sources-422, reviewer-403, and `assert key not in r.text` assertions (extend the happy-path test or add one).

- [ ] **Step 2: Run — verify fail** — `cd backend && python -m pytest tests/test_trust_toc.py::test_toc_prompt_asks_for_subtopics_and_drops_sparse_hedge tests/test_trust_router.py -k suggest -v` → FAIL (no subtopics).

- [ ] **Step 3: Schema (`toc_suggest.py`).**
```python
class _TocSubtopic(BaseModel):
    label: str
    detail: str | None = None

class _TocTopic(BaseModel):
    title: str
    subtopics: list[_TocSubtopic] = Field(default_factory=list, max_length=12)
    sources: list[str] = []
```
Change `_MAX_TOKENS = 2048` → `_MAX_TOKENS = 4096`. `_TocSubject`/`_TocOutput` bounds unchanged (subjects 1–6, topics 1–8).

- [ ] **Step 4: Prompt (`toc_prompt.py`).** Replace the instruction paragraph + JSON schema example. Keep the `labelled` source block and the context line. New body (verbatim intent):
```python
    return (
        f"You are outlining a long-form work{ctx_line}. Using ONLY the sources below, propose an "
        f"outline of what the sources actually cover: 1 to 6 subjects, each with 1 to 8 topics. "
        f"For each topic, break it into the concrete subtopics the sources actually discuss — be "
        f"thorough; do not collapse a topic to a bare title. Give a subtopic a short one-line "
        f"'detail' when the sources support a concrete gloss; otherwise leave detail empty (label "
        f"only). Attribute each topic to the source label(s) it draws from. Invent nothing beyond "
        f"the sources — if the sources do not cover something, omit it.\n\n"
        f"SOURCES:\n{labelled}\n\n"
        f"Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        f'{{"subjects": [{{"subject_label": "string", "topics": [{{"title": "string", '
        f'"subtopics": [{{"label": "string", "detail": "string or null"}}], "sources": ["S1"]}}]}}]}}'
    )
```
(The "propose few topics" sentence is removed.)

- [ ] **Step 5: Endpoint mapping (`router.py`, in `suggest_project_toc`, the `"subtopics": []` line ~624).** Replace with:
```python
                        "subtopics": [
                            ({"label": st.label, "detail": st.detail} if st.detail else st.label)
                            for st in t.subtopics
                        ],
```
Nothing else in the mapping changes (`id`, `title`, `prerequisites`, `source_ids`, `by_label`).

- [ ] **Step 6: Run tests + ruff.** `cd backend && python -m pytest tests/test_trust_toc.py tests/test_trust_router.py -v` (new + existing pass); from repo root `backend/.venv/bin/ruff check backend/ pipeline/ && backend/.venv/bin/ruff format --check backend/ pipeline/`.

- [ ] **Step 7: Commit.**
```bash
git add backend/src/trust/toc_suggest.py backend/src/trust/toc_prompt.py backend/src/trust/router.py backend/tests/test_trust_toc.py backend/tests/test_trust_router.py
git commit -m "feat(trust): Suggest-TOC returns subtopics per topic (deeper outline)"
```

---

### Task 2: Mobile — confirm subtopics flow into the editor (test-only)

**Files:**
- Test: `mobile/__tests__/screens/TrustProjectDetail.structure.test.tsx` (extend) and/or the `tocViewToStructured` unit test if one exists.

**Interfaces:**
- Consumes: the deeper `/suggest-toc` payload (Task 1) — topics with `subtopics: (string | {label,detail})[]`. No app-code change expected.

- [ ] **Step 1: Write the failing/covering test.** In `TrustProjectDetail.structure.test.tsx`, the mocked `suggestToc` currently resolves a `suggestedToc` with a topic that has `subtopics: []`. Change that fixture's topic to carry `subtopics: ["Note values", { label: "Key signatures", detail: "sharps/flats at the clef" }]`. After pressing Suggest, assert a subtopic renders — e.g. `expect(await screen.findByDisplayValue("Note values")).toBeTruthy()` (TopicTreeEditor renders subtopics as editable rows) OR `getByText("Key signatures")` depending on how the editor renders a `{label,detail}` subtopic. First READ `mobile/src/components/TopicTreeEditor.tsx` to see exactly how it renders a bare-string vs `{label,detail}` subtopic, and assert against the real rendering (display value for an editable input, text for a label).

- [ ] **Step 2: Run — verify it exercises the path** — `cd mobile && npx jest __tests__/screens/TrustProjectDetail.structure.test.tsx -t Suggest`. If it already passes (because the editor renders subtopics and the mapper is lossless), that CONFIRMS no app change is needed — the test now guards the depth path. If it fails, the gap is in `tocViewToStructured`/`toSubtopics`; fix the mapper (should already handle the union — investigate before changing).

- [ ] **Step 3: Full mobile check.** `cd mobile && npx jest __tests__/screens/TrustProjectDetail && npx tsc --noEmit`.

- [ ] **Step 4: Commit.**
```bash
git add mobile/__tests__/screens/TrustProjectDetail.structure.test.tsx
git commit -m "test(trust): Suggest-TOC subtopics render in the Structure editor"
```

---

## Final verification (after both tasks)

- [ ] Backend: `cd backend && python -m pytest tests/test_trust_toc.py tests/test_trust_router.py -v` all pass; no-key assertion green; `ruff check` + `ruff format --check` clean.
- [ ] Mobile: `cd mobile && npx jest __tests__/screens/TrustProjectDetail && npx tsc --noEmit` green.
- [ ] PR body: **prod backend refresh (no migration)** on ship — the new prompt/schema change the `/suggest-toc` output. **No web redeploy / APK rebuild required** (mobile already renders subtopics; the change is server-driven).

## Self-Review

- **Spec coverage:** subtopics schema + max_tokens (T1 s3) · prompt with subtopic/detail guidance, hedge dropped (T1 s4) · endpoint maps subtopics as string|{label,detail} (T1 s5) · mobile renders them (T2). Grounding/attribution/auth/error-handling unchanged.
- **Type consistency:** `_TocSubtopic{label,detail}` (T1) → endpoint emits `string | {label,detail}` → client `toSubtopics` union (T2) — same shape end to end.
- **Placeholders:** none — schema, prompt, and mapping code are literal.
- **No color/uninvolved changes**; ADR-001 key-leak assertion preserved.
