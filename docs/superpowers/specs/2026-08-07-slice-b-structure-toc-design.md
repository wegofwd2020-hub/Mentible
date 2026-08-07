# Slice B — Structure (TOC) phase for Projects — Design

**Status:** Approved (brainstorming, 2026-08-07). Slice B of the Projects TOC-structure arc
(`docs/superpowers/specs/2026-08-07-projects-toc-structure-arc-design.md`). Follows Slice A
(editable sources, #381–#383).

## Problem

Projects jumps Input → Drafts with no structuring step and no wayfinding (Sridhar #2), and generated
book drafts come out thin (#3) because the model freely invents a short section list. Studio already
has an outline editor. Slice B gives Projects a **Structure phase**: the author builds an editable
outline (TOC) from their sources — optionally auto-suggested — before drafting.

## Goal

A new **Structure** phase between Input and Drafts: build/edit a TOC (add/rename/reorder/delete
topics), **Suggest an outline from the sources** (grounded), see per-topic **source coverage**,
persist it on the project, then **Next → Drafts**.

## Decisions (brainstorming 2026-08-07)

1. **Suggest = inline synchronous**, source-grounded — a new `POST /trust/projects/{id}/suggest-toc`
   modeled on the existing inline `generate_draft` (reads `project_input`, "invent nothing", one LLM
   call, returns the `StructuredTOC` directly). Account-authenticated, managed-or-BYOK key (mirrors
   `generate_version`). NOT the Studio `/structure` BYOK-job scaffold.
2. **Scope = build + persist + Suggest only.** Generation is UNCHANGED (Drafts = the multi-format
   picker as today). Feeding the TOC into book generation (adding an outline param to
   `generate_draft`) is **Slice C**.
3. **Suggest returns topics + per-topic source coverage** — each topic carries `source_ids`
   (S-labels mapped back to real input ids, like `generate_version`), rendered as read-only chips so
   coverage/gaps show.
4. The Structure phase is **optional / skippable** (Next), framed for long-form — not hard-gated per
   format (a project has no target format at this stage). Gating book/essay generation on a TOC is
   Slice C.

## Reuse (all cited in the arc's reuse map)

- `mobile/src/components/TopicTreeEditor.tsx` — controlled, book-agnostic; `{ toc: StructuredTOC;
  onChange: (next) => void }`. Reused verbatim + one small read-only addition (source chips).
- `StructuredTOC / SubjectNode / TopicNode` (`mobile/src/types/book.ts`) — shared shape;
  `TopicNode` extended with optional `source_ids?: string[]` (client-only, like `id`).
- `generate_draft` grounding + `S1..Sn` → input-id mapping (`generate.py`, `draft_prompt.py`,
  `router.py:376-384`) — copied for the suggest generator.
- Phase-flow (`projectPhase.ts`, `PhaseTabBar.tsx`) — extended; `PhaseTabBar` unchanged.

## Architecture

### Backend (`backend/src/trust/`)

**1. Migration `0014` + model** — `ALTER TABLE project ADD COLUMN toc jsonb` (nullable; downgrade
drops it). `down_revision = "0013"`. Add `toc: dict | None = None` to the `Project` dataclass
(`models.py`) and to the `_P` column list + `_project` mapper in `project_repo.py`.

**2. TOC suggest generator** (`toc_suggest.py`, new — mirrors `generate.py`):
- `suggest_toc(*, sources, topic, audience, goal, provider_id, api_key, model) -> _TocOutput`
  where `_TocOutput` is a Pydantic schema:
  ```python
  class _TocTopic(BaseModel):
      title: str
      sources: list[str] = []          # S-labels the topic draws on
  class _TocSubject(BaseModel):
      subject_label: str
      topics: list[_TocTopic] = Field(min_length=1)
  class _TocOutput(BaseModel):
      subjects: list[_TocSubject] = Field(min_length=1, max_length=6)
  ```
- `build_toc_prompt(sources, topic, audience, goal)` — labels sources `[S1]..[Sn]` (reuse the
  draft-prompt labelling), and instructs: *"Using ONLY the sources below, propose an outline
  (subjects → topics) of what the sources actually cover. Attribute each topic to the source
  label(s) it draws from. Invent nothing beyond the sources — if the sources don't cover something,
  omit it. If the sources are thin, propose few topics."* JSON schema for `_TocOutput`.
- Uses `build_provider` + `generate_validated` (same as `generate_draft`).

**3. Suggest endpoint** — `POST /trust/projects/{project_id}/suggest-toc` (owner-only,
`dependencies=[Depends(enforce_rate_limit)]` like generate):
- Load project + sources (`project_repo.list_inputs`); 422 if no sources.
- Key handling identical to `generate_version` (managed vs `body.api_key`).
- Call `suggest_toc(...)` off the event loop (`asyncio.to_thread`), same error mapping as
  `generate_version` (LLMSchemaError → 502, etc.).
- Map each topic's `S1..Sn` labels → real input ids (`by_label`, like `router.py:376`), producing a
  `StructuredTOC`-shaped payload where each `TopicNode` has `id` (new uuid), `title`, `subtopics: []`,
  `prerequisites: []`, and `source_ids: [<input uuid>...]`. Return it as `TocSuggestOut { toc: {...} }`
  (does NOT persist — the client persists after the user edits).

**4. Persist endpoint** — `PUT /trust/projects/{project_id}/toc` (owner-only), body
`{ toc: <StructuredTOC-shaped object> }` → `project_repo.update_project_toc(conn, project_id, toc)`
→ returns the project. Validation: `toc.subjects` is a list (light structural check).

**5. `GET /projects/{id}` (ProjectDetailOut)** — include `toc` on the project so the client can
render/seed the Structure phase.

### Mobile (`mobile/`)

**6. Phase-flow** (`src/lib/projectPhase.ts`) — add `"structure"` to `PhaseKey`, insert into
`PHASE_ORDER` at index 1 (`["capture","structure","create","validate","share"]`),
`PHASE_LABELS.structure = "Structure"`. In `deriveProjectPhase`, add `structure` to the `done` map:
`structure: !!(detail.toc?.subjects?.length)`. `basePhase`/seed/fallback unchanged. `PhaseTabBar`
unchanged.

**7. Types + client** (`src/api/trustClient.ts`) — `toc?: StructuredTocView` on `ProjectView`
(shape `{ subjects: { subject_label: string; units: { id, title, subtopics, prerequisites,
source_ids? }[] }[] }`); `suggestToc(projectId, key, token): Promise<StructuredTocView>` (POST) and
`saveToc(projectId, toc, token): Promise<void>` (PUT). Reuse the trust client's key resolution
(`loadApiKey("anthropic")` in the hook, like `generateVersion`).

**8. Hook** (`useTrustProject`) — `suggestToc()` (loads key → POST → returns toc) and `saveToc(toc)`
(PUT → refresh). `project.toc` surfaced.

**9. StructurePanel** (`app/trust/[projectId].tsx`, new panel + render branch):
- Local editable `toc` state seeded from `project.toc` (or an empty `{subjects:[]}`).
- `<TopicTreeEditor toc={toc} onChange={setToc} />` (owner). On change, **debounced `saveToc`**
  (or a Save affordance) so edits persist. Reviewer: read-only (render the tree without edit
  handlers, or a read-only view).
- A **"Suggest from sources"** button (owner) → `suggestToc()` → `setToc(result)` (spinner while
  loading; disabled when `inputs.length === 0` with an "Add a source first" hint; on error show
  `ApiError.userMessage()`). Suggesting REPLACES the editor content (confirm if the TOC is non-empty).
- A **`Next`** button → advance to the `create` (Drafts) phase (set the selected tab).
- Render in the phase switch: `active === "structure" ? <StructurePanel .../> : null` between the
  `capture` and `create` branches.

**10. `TopicTreeEditor` source chips** — extend `TopicNode` with `source_ids?: string[]`; render them
per topic as read-only chips labelled by S-index resolved from `project.inputs` order (id→`S{n}`,
same mapping as the viewer/compare `labelFor`) — parallel to the existing read-only prerequisites
chips. The editor stays controlled; `source_ids` are preserved through `onChange` (the structural
clone already deep-copies them). Editing a topic's title/order/removal keeps its `source_ids`.

## Data flow

```
Input (sources) → Structure tab
  Suggest from sources → POST /trust/projects/{id}/suggest-toc
     → grounded LLM → subjects[].topics[] with S-labels → map S→input ids
     → StructuredTOC (topics carry source_ids) → fills TopicTreeEditor
  edit (add/rename/reorder/delete) → onChange → PUT /trust/projects/{id}/toc (persist)
  Next → Drafts (create phase, generation unchanged)
```

## Error handling

- Suggest: no sources → 422 ("add a source first"); LLM failure → 502 (reuse generate's mapping);
  client shows `userMessage()`, editor unchanged.
- Save: PUT failure → inline error, keep the edit buffer.
- Empty TOC is valid (the phase is optional) — `Next` always works.

## Testing

**Backend (pytest, mocked LLM):**
- `build_toc_prompt` includes source content, `[S1]` labels, "Invent nothing", JSON schema.
- `suggest_toc` returns subjects/topics; the endpoint maps `S`-labels → real input ids on each topic
  (`source_ids` are the input uuids); no sources → 422; owner-only (reviewer 403); malformed → 502.
- `PUT /projects/{id}/toc` persists (owner-only); `GET /projects/{id}` returns the stored `toc`.
- `update_project_toc` round-trips the jsonb blob.

**Mobile (Jest + RNTL):**
- `deriveProjectPhase`: `structure` done iff `toc.subjects.length > 0`; phase order has structure
  between capture and create.
- StructurePanel: Suggest calls `suggestToc` and fills the editor; disabled with no inputs; edits
  call `saveToc`; Next advances to the Drafts tab; reviewer sees read-only (no Suggest/edit).
- `TopicTreeEditor`: a topic with `source_ids` renders `[S1]` chips (id→label from inputs); editing
  preserves `source_ids`.

## Files

**Backend**
- `alembic/versions/0014_project_toc.py` (new); `src/trust/models.py`, `src/trust/project_repo.py`
  (`toc`, `update_project_toc`); `src/trust/toc_suggest.py` (new); `src/trust/toc_prompt.py` (new or
  in toc_suggest); `src/trust/router.py` (suggest + PUT toc + toc in detail); `src/trust/schemas.py`
  (`TocSuggestOut`, `TocSaveIn`, `toc` on `ProjectOut`).
- Tests: `backend/tests/test_trust_toc.py` (new) + `test_trust_router.py`.

**Mobile**
- `src/lib/projectPhase.ts`; `src/api/trustClient.ts`; `src/hooks/useTrustProject.ts`;
  `src/components/TopicTreeEditor.tsx` (source chips); `src/types/book.ts` (`source_ids?` on TopicNode);
  `app/trust/[projectId].tsx` (StructurePanel + phase branch).
- Tests under `mobile/__tests__/`.

## Rollout

Backend adds a **migration (0014)** + endpoints → **prod backend refresh + `alembic upgrade head` on
ship**. Web redeploy for the UI.

## Global constraints reminder

Owner-only for suggest/save; reviewers read-only. App-level authz, no RLS. "Invent nothing beyond the
sources" grounding on suggest. `useThemedStyles`; RN literals `as const`; ruff clean; CORS already
allows the methods used (GET/POST/PUT are in `allow_methods`).
