# P0-2 — Finish the trust review loop — Design

**Status:** Approved (brainstorming, 2026-08-16). Completes the ADR-037 review loop
([`PRIORITIZED_SHORTLIST.md`](../../competitive-analysis/PRIORITIZED_SHORTLIST.md) P0-2). Three
independent slices in one spec: **(A) inline section comments · (B) version diff · (C)
reviewer/editor roles.** Decomposes A→B→C for implementation.

## Context (verified)

- **Feedback is version-scoped, no section anchor.** `feedback` table (migration 0009): `id`,
  `version_id`, `author_kind`, `author_name`, `body`, `created_at`, `seq` (0013). Rendered in the
  version viewer's "Revision notes" block as one flat list per version.
- **Roles = owner + reviewer.** `access.py` `PROJECT_ROLES = ("owner", "reviewer")`;
  `require_project_access` returns `"owner"` (project owner) or the `project_membership.role`.
  `router._require_role(conn, account, project_id, *, need_owner)` is **binary**: `need_owner=True`
  → owner only; `need_owner=False` → owner OR **any** membership role. It returns the role string.
- **Endpoint gates today:** `create_version` (edit/save) + all mutating project/input/invite/toc ops
  → `need_owner=True`. `approve`/`withdraw` + `get_version` + add-feedback → `need_owner=False`.
- **Versions are immutable** and carry `content.sections: DraftSection[]` (`{heading, body,
  source_ids}`). The version viewer already fetches a version (`getVersion`) and renders it via the
  reader (P0-2 predecessor work). `isOwner = project?.my_role === "owner"` drives owner-only UI.

## Decisions (brainstorming 2026-08-16)

1. **Comment anchor = `version_id` + `section_index`.** A comment pins to a section *index within a
   specific (immutable) version*. `section_index` is **nullable** — null = whole-version comment
   (today's behaviour, unchanged). Comments do NOT auto-carry to a new version (they belong to the
   version they were made on).
2. **Version diff = section-level, matched by heading, client-side.** Classify each section
   Added / Removed / Changed (heading matches, body differs) / Unchanged. **No** within-section
   text diff, **no** backend.
3. **Roles: reviewer = comment + APPROVE (no edit); editor = comment + EDIT (no approve); owner =
   all.** Separation of duties — the editor can't approve their own edits.

---

## Slice A — Inline section comments

### Backend
- **Migration `0019_feedback_section_index`:** `ALTER TABLE feedback ADD COLUMN section_index integer NULL`.
  (Nullable → existing rows = whole-version, backward-compatible.)
- **`models.Feedback`** += `section_index: int | None`.
- **`schemas.py`:** `FeedbackIn` += `section_index: int | None = None`; `FeedbackOut` += `section_index: int | None`.
- **`feedback_repo`:** `add_feedback(...)` stores `section_index`; `list_feedback(...)` returns it
  (select the column).
- **The add-feedback endpoint:** accept `section_index`; **validate** — if not null, load the target
  version's `content.sections` and require `0 <= section_index < len(sections)`, else
  `HTTPException(422, "section_index out of range")`. Allowed roles: **owner, reviewer, editor** (see
  Slice C's `_require_role` generalization; until C lands, it stays `need_owner=False`).

### Mobile
- **`trustClient`:** `FeedbackView` += `section_index: number | null`; `addFeedback(versionId, { body,
  section_index? })` sends it.
- **Version viewer (`app/trust/version/[versionId].tsx`), view mode:** the draft renders through the
  reader (one doc), so per-section comment affordances live in a **thin per-section control row**
  rendered from `version.content.sections` alongside the reader (not inside the WebView). For each
  section index `i`: a **"Comment" button** → an inline input → `addFeedback(versionId, { body,
  section_index: i })`. Comments for section `i` (`feedback.filter(f => f.section_index === i)`)
  render under that section's control row. Whole-version comments (`section_index == null`) stay in
  the existing **Revision notes** block.
- **Reviews surface** uses the same viewer, so reviewers get the same per-section comment control.
- Memoize as needed (no inline object churn — the #400 lesson).

### Tests
- pytest: `section_index` round-trips; out-of-range → 422; null → whole-version (unchanged).
- jest: a section with a comment renders it anchored; posting a section comment calls `addFeedback`
  with the right `section_index`; whole-version comments still render in Revision notes.

---

## Slice B — Version diff (client-side, no backend)

### Mobile
- **Pure util `mobile/src/lib/diffVersions.ts`:** `diffVersions(prev: DraftSection[], curr:
  DraftSection[]): SectionDiff[]` where `SectionDiff = { heading: string; status: "added" |
  "removed" | "changed" | "unchanged" }`. Match by `heading`: a heading in curr-not-prev = added;
  prev-not-curr = removed; both but `body` differs = changed; both + same body = unchanged.
  Duplicate headings: match positionally within the same-heading group (documented; rare).
- **Version viewer:** a **"Changes from v{n-1}"** toggle (shown when a previous version exists). On
  open, fetch the previous version's detail (`getVersion(prevVersionId)` — the prev version id comes
  from the artifact's `versions` list in `project`), compute `diffVersions(prev.sections,
  curr.sections)`, and render a compact summary list (`+ Added`, `− Removed`, `~ Changed`, with
  headings). Memoize the fetched prev + the diff. Closed by default.

### Tests
- jest (pure fn): added / removed / changed / unchanged; empty prev (v1 → all added-ish or hidden);
  reordered-but-same → all unchanged (heading match is order-independent); duplicate heading case.
- jest (viewer): toggle fetches prev + shows the summary; hidden when no previous version.

---

## Slice C — Reviewer/editor roles

### Backend (the shared enabler + the matrix)
- **`access.py`:** `PROJECT_ROLES = ("owner", "reviewer", "editor")`.
- **Generalize `_require_role`:** replace `need_owner: bool` with `allow: tuple[str, ...]` — after
  resolving the role via `require_project_access`, `if role not in allow: raise
  HTTPException(403, "insufficient role")`. Return the role. Update ALL call sites:
  - **Edit / create-version / save:** `allow=("owner", "editor")` (was `need_owner=True`).
  - **approve / withdraw:** `allow=("owner", "reviewer")` (was `need_owner=False` — which, once
    `editor` exists, would WRONGLY let editors approve; this pins it).
  - **add-feedback (comment):** `allow=("owner", "reviewer", "editor")`.
  - **read (get_version, get_project, listing):** `allow=("owner", "reviewer", "editor")`.
  - **All other owner-only ops** (create_project, create_artifact, inputs add/edit/delete, invite,
    toc, delete): `allow=("owner",)`.
- **Invite gains a role:** `InviteIn` += `role: Literal["reviewer","editor"] = "reviewer"`;
  `invite` endpoint (owner-only) passes it to `membership_repo` so the redeemed membership row gets
  that role. Redeem-on-login is unchanged (it materializes whatever role the invite carried).

### Mobile
- **Invite UI** (owner, in the project screen): a role picker (**Reviewer** / **Editor**) on invite.
- **Version viewer role-aware controls:** derive `role = project?.my_role`; `isOwner = role ===
  "owner"`, `canEdit = role === "owner" || role === "editor"`, `canApprove = role === "owner" ||
  role === "reviewer"`. Gate **Edit/save** on `canEdit`, **Approve/withdraw** on `canApprove`
  (replacing the current blanket `isOwner`). Comment is available to all.

### Tests
- pytest (access): each endpoint accepts its allowed roles and 403s the rest — esp. **editor is 403
  on approve**, **reviewer is 403 on create-version**, **both 200 on comment**. Invite stores the
  chosen role; redeemed membership has it.
- jest: an editor sees Edit not Approve; a reviewer sees Approve not Edit; owner sees both; invite
  sends the chosen role.

---

## Cross-cutting

- **App-level access only — no RLS, no tenant column** (backend rule #4 / ADR-037 nuance). The role
  matrix lives entirely in `_require_role` + `require_project_access`.
- **No PII change.** No new external calls.
- **Global constraints:** `asyncpg`; migrations are additive + backward-compatible. Mobile:
  `useThemedStyles`; no color-literal test asserts; `npx tsc --noEmit` + full `npx jest` + `npx
  eslint .` green. Backend: `pytest`, mandatory key-redaction untouched, 70% coverage gate. Commits
  end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Decomposition (SDD)

- **T1 — Slice A (inline section comments):** migration 0019 + models/schemas/repo + endpoint
  validation (backend) → trustClient + version-viewer per-section comment control + anchored render
  (mobile). Tests.
- **T2 — Slice B (version diff):** `diffVersions.ts` pure util + tests, then the viewer toggle +
  prev-fetch + summary render. Tests.
- **T3 — Slice C (reviewer/editor roles):** `_require_role` `allow`-set generalization + PROJECT_ROLES
  + per-endpoint matrix + invite role (backend) → invite role picker + role-aware viewer controls
  (mobile). Tests. (T3 last — it's the access-control change; A/B don't depend on it, and A's
  add-feedback allow-set is finalized here.)

## Rollout

Backend migration (`alembic upgrade head` on the prod refresh) + web deploy + APK. No data
backfill (all new columns nullable / additive). Native comment/diff render device-verified via the
existing stub-backend recipe if needing runtime confirmation.

## Out of scope

- Within-section (word/line) text diff. Real-time collaboration / presence. @mentions, threading,
  file attachments on comments (ADR-025 — separate). Carrying comments across versions. More than
  the three roles. Notifications when a comment/role changes.

## Open (non-blocking)

- Comment edit/delete (v1 = append-only, like the existing feedback log). Revisit if reviewers ask.
- Duplicate-heading diff matching is positional-within-group; fine for now.
