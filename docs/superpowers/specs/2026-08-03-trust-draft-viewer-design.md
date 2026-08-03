# Trust Draft Content Viewer + Edit + Regenerate — Design

**Status:** Approved (brainstorming, 2026-08-03)
**Context:** ADR-037 trust/validation workspace. Slice of the deferred "real Publish/export"
wayfinding work. Companion: `mobile/app/trust/[projectId].tsx` (phase-flow workspace).

## Problem

The trust workspace can generate a draft (an `artifact_version` with
`content = {"sections":[…]}`) and record an expert approval, but **no surface renders that
content**. `GET /trust/projects/{id}` returns version *metadata* only
(`VersionSummaryOut`: `version_no`, `is_validated`, `recorded_via`) — never the text. The
Drafts/Feedback panels show `v1 / Validated ✓`; the Publish tab is a placeholder.

Two consequences, both live on production:

1. **Owner can't read the draft.** (Reported: Sridhar generated "Medicare planning", can't
   see the output.)
2. **Reviewers approve blind.** The reviewer approved v1 without ever seeing its text.

## Goal

A full-screen surface to **read** a draft version's content, **edit** it per-section (saved
as a new immutable version), and **regenerate** it from sources with optional guidance —
reachable from both the owner's Drafts panel and the reviewer's Feedback panel.

## Non-goals

- Export to EPUB/PDF/share links (separate Publish slice — the placeholder tab stays).
- Mutating existing versions (versions are append-only; "edit" = new version).
- Carrying an approval forward across an edit (an approval is bound to specific content).
- Source (`project_input`) editing UI — already exists in the Sources panel.

## Core semantics

**Append-only versions.** Every edit and every regenerate creates a **new** version. v1 (the
approved one) is never modified. This is deliberate: the version history *is* the audit trail,
which is the trust product (ADR-037, "trust is the product").

**Approval does not carry.** If the author edits/regenerates a *validated* version, the new
version is unvalidated and needs re-approval. The existing approval stays pinned to the old
version. The UI must warn before doing this.

**Reviewer may read, not write.** `require_project_access` returns `owner` or `reviewer`.
Read is allowed for both. Edit/regenerate/save remain owner-only (unchanged
`need_owner=True` on `create_version`/`generate_version`).

## Architecture

### Backend (FastAPI, `backend/src/trust/`)

**1. New read endpoint** — `GET /api/v1/trust/versions/{version_id}` → `VersionDetailOut`:

```python
class VersionDetailOut(BaseModel):
    id: str
    artifact_id: str
    version_no: int
    content: dict            # {"sections": [{"heading","body","source_ids"}]}
    generation_meta: dict | None
    is_validated: bool
    recorded_via: str | None
    created_at: datetime | None
```

Guard: resolve `project_id` via the existing `access.project_id_for_version`, then
`require_project_access(account_id, project_id)` (ProjectAccessError → HTTP 403; unknown
version → 404). `is_validated`/`recorded_via` come from the same approval lookup the detail
endpoint already uses. Repo: add `artifact_repo.get_version(conn, version_id)` returning the
row (content already JSON-decoded by the existing `_row` mapper).

**2. Guidance on regenerate** — add to `DraftGenerateIn`:

```python
    guidance: str | None = Field(default=None, max_length=500)
```

Thread through `generate.generate_draft(…, guidance=None)` →
`draft_prompt.build_draft_prompt(…, guidance=None)`, which appends one bounded line to the
prompt (e.g. `Additional guidance from the author: {guidance}`) when present. Guidance is the
owner's own text going into the owner's own prompt — cap length, no other sanitization needed
(it is not rendered as HTML anywhere). Persist it into the new version's `generation_meta`
(alongside the existing provider/model) for traceability.

**3. Save-edit** — *no change.* Reuse `POST /artifacts/{artifact_id}/versions`
(`create_version`, `VersionCreateIn.content`, owner-only). The mobile client sends the edited
`{"sections":[…]}` as `content`.

### Mobile (RN + Expo, `mobile/`)

**4. New route** `mobile/app/trust/version/[versionId].tsx`. Params: `versionId` (path),
plus `artifactId` and `projectId` (query — needed for save/regenerate/back-nav; version
detail alone doesn't give projectId to the client cheaply). Wrapped in `SmeThemeScope`
(Navy Trust + Fraunces headings, matching the workspace). Reachable via
`router.push({ pathname: "/trust/version/[versionId]", params: { versionId, artifactId, projectId }})`.

Screen states:
- **Read (default):** fetch `getVersion(versionId)`; render each section — heading
  (Fraunces), body, citation chips (`source_ids`, read-only). Header shows `v{n}` +
  validated/`recorded_via` badge. Owner sees `Edit` + `Regenerate` actions; reviewer sees
  read-only (+ Approve, see #7).
- **Edit:** per-section editable — heading `TextInput`, body `TextInput`, add-section,
  remove-section, reorder (up/down). Citation chips shown but not edited. `Save` →
  `addVersion(artifactId, { sections })` → on success navigate to the new version. `Cancel`
  → back to Read.
- **Regenerate:** optional guidance `TextInput` → `generateVersion(artifactId, { guidance })`
  → navigate to the new version.

**5. Client + hook extensions**
- `trustClient.getVersion(versionId, token): Promise<VersionDetailView>` (new).
- `trustClient.generateVersion(artifactId, { api_key, provider_id, guidance? }, token)` — add
  `guidance`.
- `useTrustProject.generateVersion(artifactId, opts?: { guidance?: string })` — thread
  `guidance`. `addVersion(artifactId, content)` already exists — reused as-is.

**6. Drafts panel entry point** (`trust/[projectId].tsx`) — version rows become a `Pressable`
that pushes the version route (a clear "Read" affordance). Feedback panel rows get the same
tap.

**7. Reviewer read-then-approve** — the Feedback panel's Approve remains, but a reviewer can
now tap a version to open the read screen first. Approve action also surfaced on the read
screen for reviewers (calls existing `approve(versionId, note?)`).

**8. Approval-invalidation confirm** — when the opened version `is_validated`, `Edit` and
`Regenerate` first show a confirm (`@/lib/alert`): *"This creates a new version. The approval
on v{n} stays; the new version will need re-approval. Continue?"*

### Help (Definition of Done gate)

Add a feature key to `mobile/src/help-content/features.ts` and a matching Help topic in
`topics.ts` (the coverage test fails otherwise) — how to read, edit, and regenerate a draft.

## Data flow (edit)

```
Read screen (owner) → Edit → mutate local sections[] → Save
  → addVersion(artifactId, {sections})
  → POST /artifacts/{id}/versions (create_version, owner-only)
  → new artifact_version (version_no+1, unvalidated)
  → navigate to /trust/version/{newId}
```

## Data flow (regenerate)

```
Read screen (owner) → Regenerate → guidance? → generateVersion(artifactId,{guidance})
  → POST /artifacts/{id}/versions/generate (owner-only)
  → build_draft_prompt(sources, …, guidance) → LLM → validated sections
  → new artifact_version (guidance stored in generation_meta)
  → navigate to /trust/version/{newId}
```

## Error handling

- Read: 404 (no such version) → "This draft version no longer exists." 403 → "You don't have
  access to this project." Network → inline retry.
- Save: validation/network error → keep edit buffer, show inline error (never lose edits).
- Regenerate: reuse the Drafts panel's existing generate error path (502 "generated draft
  failed validation", missing key, etc.).

## Testing

**Backend (pytest + httpx, mocked LLM):**
- `GET /versions/{id}`: owner 200 with content; reviewer 200; non-member 403; unknown id 404.
- Guidance reaches the prompt (`build_draft_prompt` includes the guidance line) and lands in
  `generation_meta`; absent guidance → prompt unchanged.
- Edit path: `create_version` with sections yields `version_no+1`, unvalidated, v1 intact.

**Mobile (Jest + RNTL):**
- Read renders section headings/bodies/citation chips from a mocked `getVersion`.
- Edit → Save calls `addVersion(artifactId, {sections:…})` with edited buffer.
- Regenerate passes `guidance` through to `generateVersion`.
- Validated version → Edit/Regenerate triggers the confirm before calling.
- Help coverage test passes (feature key ↔ topic).

## Files

**Backend**
- `src/trust/schemas.py` — `VersionDetailOut`; `guidance` on `DraftGenerateIn`.
- `src/trust/artifact_repo.py` — `get_version`.
- `src/trust/router.py` — `GET /versions/{version_id}`; pass `guidance` into generate.
- `src/trust/generate.py`, `src/trust/draft_prompt.py` — `guidance` param.
- Tests under `backend/tests/trust/`.

**Mobile**
- `app/trust/version/[versionId].tsx` (new).
- `src/api/trustClient.ts` — `getVersion`, `VersionDetailView`, `guidance` on generate.
- `src/hooks/useTrustProject.ts` — `guidance` on `generateVersion`.
- `app/trust/[projectId].tsx` — tappable version rows (Drafts + Feedback).
- `src/help-content/features.ts`, `topics.ts` — new feature + topic.
- Tests under `mobile/__tests__/`.

## Rollout note

Backend adds an endpoint + a request field → **prod backend must be refreshed** when this
ships (per the recurring "prod backend lags main → 404s" lesson), or the mobile read screen
404s on production.
